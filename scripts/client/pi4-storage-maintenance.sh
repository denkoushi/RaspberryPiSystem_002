#!/usr/bin/env bash
# Pi4 端末のストレージメンテナンススクリプト
# 毎日実行され、古いリリースイメージ・Build Cache・aptキャッシュを削除する
#
# 残すイメージ:
#   - コンテナが使用中のイメージ（現行）
#   - リポジトリごとに、使用中でない最新 PI4_STORAGE_KEEP_PREVIOUS 個（直前の戻し先）
#   - 作成から PI4_STORAGE_ROLLBACK_TAG_KEEP_HOURS 時間以内の rollback タグが指すイメージ
#     （実行中のリリースが rollback に使うため）
#
# PI4_STORAGE_REMOVE_FIREFOX=1 のとき（Chromiumキオスク）、Firefox本体と
# そのプロファイル・キャッシュも削除する。
#
# 使用方法:
#   # 削除対象の確認だけ行う
#   PI4_STORAGE_DRY_RUN=1 pi4-storage-maintenance.sh
#
#   # systemd timerで毎日実行（Ansibleで自動設定される）

set -euo pipefail

DOCKER_BIN="${PI4_STORAGE_DOCKER_BIN:-docker}"
APT_GET_BIN="${PI4_STORAGE_APT_GET_BIN:-apt-get}"
KEEP_PREVIOUS="${PI4_STORAGE_KEEP_PREVIOUS:-1}"
ROLLBACK_TAG_KEEP_HOURS="${PI4_STORAGE_ROLLBACK_TAG_KEEP_HOURS:-24}"
DRY_RUN="${PI4_STORAGE_DRY_RUN:-0}"
REMOVE_FIREFOX="${PI4_STORAGE_REMOVE_FIREFOX:-0}"
HOME_ROOT="${PI4_STORAGE_HOME_ROOT:-/home}"
DPKG_QUERY_BIN="${PI4_STORAGE_DPKG_QUERY_BIN:-dpkg-query}"
PGREP_BIN="${PI4_STORAGE_PGREP_BIN:-pgrep}"
NOW_EPOCH="${PI4_STORAGE_NOW_EPOCH:-$(date +%s)}"

RELEASE_REPOSITORY_PATTERN='^ghcr\.io/denkoushi/raspisys-[a-z0-9-]+$'
ROLLBACK_REPOSITORY_PATTERN='^(raspi-standard-rollback|raspi-rollback/.+)$'
LEGACY_LOCAL_BUILD_PATTERN='^docker-[a-z0-9-]+$'

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

is_in() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [ "${item}" = "${needle}" ] && return 0
  done
  return 1
}

remove_reference() {
  local reference="$1"
  if [ "${DRY_RUN}" = "1" ]; then
    log "DRY-RUN: 削除対象 ${reference}"
    return 0
  fi
  if "${DOCKER_BIN}" image rm "${reference}" >/dev/null 2>&1; then
    log "削除しました: ${reference}"
  else
    log "WARNING: 削除できませんでした: ${reference}"
    failures=$((failures + 1))
  fi
}

failures=0
log "Pi4ストレージメンテナンスを開始します（直前の保持数: ${KEEP_PREVIOUS}、dry-run: ${DRY_RUN}）"

if ! "${DOCKER_BIN}" info >/dev/null 2>&1; then
  log "WARNING: Dockerへ接続できないため、イメージ整理をスキップします"
else
  # 1. 使用中のイメージ（停止中のコンテナを含む）
  keep_ids=()
  while IFS= read -r container_id; do
    [ -n "${container_id}" ] || continue
    keep_ids+=("$("${DOCKER_BIN}" inspect --format '{{.Image}}' "${container_id}")")
  done < <("${DOCKER_BIN}" ps -aq)

  # 全イメージ: "<作成epoch> <ID> <repository> <tag>"（新しい順）
  images=()
  while IFS=$'\t' read -r image_id repository tag; do
    [ -n "${image_id}" ] || continue
    created="$("${DOCKER_BIN}" image inspect --format '{{.Created}}' "${image_id}")"
    created_epoch="$(date -d "${created}" +%s)"
    images+=("${created_epoch} ${image_id} ${repository} ${tag}")
  done < <("${DOCKER_BIN}" images --no-trunc --format '{{.ID}}\t{{.Repository}}\t{{.Tag}}')
  sorted_images=()
  if [ "${#images[@]}" -gt 0 ]; then
    while IFS= read -r line; do
      sorted_images+=("${line}")
    done < <(printf '%s\n' "${images[@]}" | sort -k1,1nr -k2,2)
  fi

  # 2. 新しい rollback タグが指すイメージは、実行中のリリースのために残す
  rollback_cutoff=$((NOW_EPOCH - ROLLBACK_TAG_KEEP_HOURS * 3600))
  fresh_rollback_references=()
  for line in "${sorted_images[@]}"; do
    read -r _ image_id repository tag <<<"${line}"
    [[ "${repository}" =~ ${ROLLBACK_REPOSITORY_PATTERN} ]] || continue
    # イメージへ最後にタグを付けた時刻（"2026-10-02 09:04:49.839 +0000 UTC"）で新旧を判定する。
    # 読めない場合は残す側に倒す。
    last_tag_time="$("${DOCKER_BIN}" image inspect --format '{{.Metadata.LastTagTime}}' "${image_id}")"
    read -r tag_date tag_clock tag_zone _ <<<"${last_tag_time}"
    tag_epoch="$(date -d "${tag_date} ${tag_clock} ${tag_zone}" +%s 2>/dev/null || echo "${NOW_EPOCH}")"
    if [ "${tag_epoch}" -ge "${rollback_cutoff}" ]; then
      keep_ids+=("${image_id}")
      fresh_rollback_references+=("${repository}:${tag}")
    fi
  done

  # 3. リリースイメージは、リポジトリごとに使用中でない最新 KEEP_PREVIOUS 個を残す
  declare -A previous_kept=()
  for line in "${sorted_images[@]}"; do
    read -r _ image_id repository _ <<<"${line}"
    [[ "${repository}" =~ ${RELEASE_REPOSITORY_PATTERN} ]] || continue
    is_in "${image_id}" "${keep_ids[@]}" && continue
    if [ "${previous_kept[${repository}]:-0}" -lt "${KEEP_PREVIOUS}" ]; then
      previous_kept[${repository}]=$((${previous_kept[${repository}]:-0} + 1))
      keep_ids+=("${image_id}")
    fi
  done

  # 4. 残さないイメージの参照を削除する（対象は自リポジトリ由来のものだけ）
  for line in "${sorted_images[@]}"; do
    read -r _ image_id repository tag <<<"${line}"
    if [[ "${repository}" =~ ${ROLLBACK_REPOSITORY_PATTERN} ]]; then
      # 古い rollback タグは、指すイメージを残す場合でもタグだけ外す
      is_in "${repository}:${tag}" "${fresh_rollback_references[@]}" && continue
      remove_reference "${repository}:${tag}"
      continue
    fi
    [[ "${repository}" =~ ${RELEASE_REPOSITORY_PATTERN} || "${repository}" =~ ${LEGACY_LOCAL_BUILD_PATTERN} ]] || continue
    is_in "${image_id}" "${keep_ids[@]}" && continue
    if [ "${tag}" = "<none>" ]; then
      remove_reference "${image_id}"
    else
      remove_reference "${repository}:${tag}"
    fi
  done

  # 5. Docker Build Cache（Pi4はビルド済みイメージをpullするため不要）
  if [ "${DRY_RUN}" = "1" ]; then
    log "DRY-RUN: Docker Build Cacheを削除します"
  elif "${DOCKER_BIN}" builder prune -a --force >/dev/null 2>&1; then
    log "Docker Build Cacheを削除しました"
  else
    log "WARNING: Docker Build Cacheの削除に失敗しました"
    failures=$((failures + 1))
  fi

  "${DOCKER_BIN}" system df 2>&1 | while IFS= read -r line; do
    log "docker system df: ${line}"
  done
fi

# 6. aptのダウンロード済みパッケージ
if [ "${DRY_RUN}" = "1" ]; then
  log "DRY-RUN: aptキャッシュを削除します"
elif "${APT_GET_BIN}" clean >/dev/null 2>&1; then
  log "aptキャッシュを削除しました"
else
  log "WARNING: aptキャッシュの削除に失敗しました"
  failures=$((failures + 1))
fi

# 7. Firefox（Chromiumキオスクでは使わない）
if [ "${REMOVE_FIREFOX}" = "1" ]; then
  if "${PGREP_BIN}" -x firefox >/dev/null 2>&1 || "${PGREP_BIN}" -x firefox-esr >/dev/null 2>&1; then
    log "WARNING: Firefoxが起動中のため、Firefoxの削除をスキップします"
  else
    for package in firefox firefox-esr; do
      if "${DPKG_QUERY_BIN}" -W -f='${Status}' "${package}" 2>/dev/null | grep -q 'install ok installed'; then
        if [ "${DRY_RUN}" = "1" ]; then
          log "DRY-RUN: パッケージ ${package} を削除します"
        elif DEBIAN_FRONTEND=noninteractive "${APT_GET_BIN}" purge -y "${package}" >/dev/null 2>&1; then
          log "パッケージ ${package} を削除しました"
        else
          log "WARNING: パッケージ ${package} の削除に失敗しました"
          failures=$((failures + 1))
        fi
      fi
    done
    for firefox_dir in "${HOME_ROOT}"/*/.mozilla "${HOME_ROOT}"/*/.cache/mozilla; do
      [ -d "${firefox_dir}" ] || continue
      if [ "${DRY_RUN}" = "1" ]; then
        log "DRY-RUN: 削除対象 ${firefox_dir}"
      else
        rm -rf -- "${firefox_dir}"
        log "削除しました: ${firefox_dir}"
      fi
    done
  fi
fi

# 8. ディスク使用量を確認
disk_usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
log "現在のディスク使用量: ${disk_usage}%"
if [ "${disk_usage}" -gt 80 ]; then
  log "WARNING: ディスク使用量が80%を超えています（${disk_usage}%）"
fi

if [ "${failures}" -ne 0 ]; then
  log "ERROR: ${failures} 件の削除に失敗しました"
  exit 1
fi

log "Pi4ストレージメンテナンスが完了しました"
