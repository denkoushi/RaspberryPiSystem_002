# 私用 Pi5 `stackchan-bridge` 標準デプロイ

最終更新: 2026-05-14

## 目的

自宅の **私用 Pi5** に載せる **`stackchan-bridge`** を、**手作業なし**で再現可能に反映する。  
秘密は **ローカル非追跡 inventory fragment** にだけ置き、コミットするのは **playbook / sample / runbook** のみとする。

## 標準ファイル

- Playbook: `infrastructure/ansible/playbooks/private-pi5-stackchan-bridge.yml`
- Sample inventory: `infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.sample.yml`
- Deploy wrapper: `scripts/private-pi5-stackchan-bridge/deploy-private-pi5-stackchan-bridge.sh`
- Bridge 実装: `scripts/private-pi5-stackchan-bridge/bridge_server.py` / `scripts/private-pi5-stackchan-bridge/stackchan_chat_core.py` / `scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py` / `scripts/private-pi5-stackchan-bridge/home_assistant_client.py` / `scripts/private-pi5-stackchan-bridge/stt_bridge_core.py` / `scripts/private-pi5-stackchan-bridge/stt_runtime_client.py`
- （`private_pi5_stackchan_compat_ip` 利用時）互換 alias 再適用 hook: `infrastructure/ansible/templates/private-pi5-stackchan-compat-ip-dispatcher.sh.j2` → Pi5 の `/etc/NetworkManager/dispatcher.d/99-stackchan-bridge-compat-ip`

## 前提

- 私用 Pi5 が **Tailscale** 参加済みで、Mac から SSH 可能。
- private Pi5 上で `sudo` が使えること。
- DGX 用の **`DGX_LLM_SHARED_TOKEN`** を把握していること。
- 任意: cold start 復旧を使うなら **`DGX_RUNTIME_CONTROL_TOKEN`** も用意すること。

## 手順

### 1. ローカル inventory fragment を作る

```bash
cp infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.sample.yml \
  infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml
```

次を **ローカル断片**だけに設定する。

- `ansible_host`
- 必要なら `ansible_password` / `ansible_become_password`
- `private_pi5_dgx_llm_shared_token`
- 必要なら `private_pi5_dgx_runtime_control_token`
- 必要なら `private_pi5_stackchan_token`
- STT を切り替える場合は `private_pi5_stt_provider` と `private_pi5_stt_*`
- Home Assistant の状態を発話文脈に入れる場合は `private_pi5_home_assistant_context_enabled` と `private_pi5_home_assistant_*`（読み取り専用・許可 entity のみ）
- 必要なら `private_pi5_stackchan_compat_ip` / `private_pi5_stackchan_compat_interface` / `private_pi5_stackchan_compat_prefix`

`inventory-private-pi5-stackchan-bridge-fragment.yml` は `.gitignore` 済み。

### 2. デプロイする

リポジトリ直下で実行:

```bash
./scripts/private-pi5-stackchan-bridge/deploy-private-pi5-stackchan-bridge.sh
```

追加で dry-run / 詳細ログを見たい場合:

```bash
./scripts/private-pi5-stackchan-bridge/deploy-private-pi5-stackchan-bridge.sh --check --diff
./scripts/private-pi5-stackchan-bridge/deploy-private-pi5-stackchan-bridge.sh -vv
```

## Playbook が行うこと

1. Tailscale preflight
2. `bridge_server.py` / `stackchan_chat_core.py` / `dgx_runtime_client.py` / `home_assistant_client.py` / STT 関連を私用 Pi5 へ同期
3. `pyproject.toml` / `uv.lock` を同期し、`uv sync --frozen` で **`/home/.../stackchan-bridge/.venv`** を再生成/更新
4. `.env` を template から生成（`0600`）
5. （任意）StackChan 互換用の **旧 LAN IP alias** を **`stackchan-bridge-compat-ip.service`（oneshot・起動時）** と **NetworkManager dispatcher `up` / `dhcp4-change`（再接続・DHCP 更新後の再適用）** で管理
6. `stackchan-bridge.service` を systemd に配備（`ExecStart=.venv/bin/python ...`）
7. `systemctl enable --now`
8. `GET /healthz` で起動確認

## 検証

playbook 成功後、追加確認は次で十分。

```bash
ssh <private-pi5-user>@<private-pi5-host> \
  'systemctl is-active stackchan-bridge && curl -fsS http://127.0.0.1:18080/healthz'
```

期待値:

- `systemctl is-active` が `active`
- `/healthz` が `ok`

StackChan 側が **旧 bridge IP** を見ている疑いがある場合は、追加で次を確認する。

```bash
ssh <private-pi5-user>@<private-pi5-host> 'hostname -I'
journalctl -u stackchan-bridge --since "5 minutes ago" --no-pager
```

- `hostname -I` で **現在の DHCP IP** を確認する
- StackChan 実機の `/chat` を叩いても **bridge ログに POST が出ない**なら、まず **bridge URL の IP ミスマッチ**を疑う（**`200` でも未達**になり得る。text-only 正本は [stackchan-community-text-only-e2e.md](./stackchan-community-text-only-e2e.md#text-only-done-criteria) 参照）
- `private_pi5_stackchan_compat_ip` を設定した場合は、`systemctl is-enabled stackchan-bridge-compat-ip.service`・`test -x /etc/NetworkManager/dispatcher.d/99-stackchan-bridge-compat-ip` と `ip -brief addr show wlan0` で alias が維持されていることも確認する（**`systemctl is-active` だけでは不十分**。oneshot は `SubState=exited` のまま alias が消え得るため、**Wi‑Fi 一度切り→再接続後**に `112` が付き直しているかを見る）

## 運用メモ

- 秘密は **private Pi5 の `.env`** と **ローカル非追跡 fragment** に限定する。
- **業務 Pi5 API の `update-all-clients.sh` 経路には混ぜない**。私用経路は private Pi5 専用 playbook で分離する。
- 将来 SSH 鍵と `NOPASSWD` を整えたら、ローカル fragment から `ansible_password` / `ansible_become_password` を外す。
- 2026-05-10 実測では、private Pi5 の DHCP IP が **`192.168.128.113`** に変わる一方、StackChan は **旧 IP `192.168.128.112`** を見続けていた。以後の標準運用では、**StackChan 設定更新**または **Pi5 側 compatibility alias** のどちらかを必ず管理対象に含める。
- 2026-05-10 late: playbook に **`private_pi5_stackchan_compat_ip`** 系変数を追加し、**`stackchan-bridge-compat-ip.service`** を標準管理に組み込んだ。実機で **`enabled` / `active`** と **`wlan0: 192.168.128.113/24 192.168.128.112/24`** を確認済み。
- 2026-05-10 以降: 調査で **NetworkManager の再接続／DHCP リース更新で secondary alias が消える**一方、**oneshot compat サービスは再実行されない**ことが原因候補として確度が高かったため、**`/etc/NetworkManager/dispatcher.d/99-stackchan-bridge-compat-ip`** を playbook で配布し、対象インタフェースの **`up` と `dhcp4-change`** で **`ip addr add || ip addr replace`** を冪等適用するようにした。
- 2026-05-11: StackChan 側の `HTTP 200` でも `replyText` が空になり `わかりません` が発話される事象は、**`ChatGPT.cpp` の `https_post_json` における `WiFiClient` 寿命不整合**が根因だった。`HTTPClient::getString()` を `WiFiClient` 破棄後に実行し得る構造を修正し、同一処理を **client 生存スコープ内**へ移動。修正後はシリアルで **`[HTTP] payload length: 1027`** を確認し、bridge 側 `POST /api/stackchan/chat/simple 200` と整合。
- 2026-05-11 時点の未解決: 応答本文取得後に **`MP3:ERROR_BUFLEN 0` / `I2S: register I2S object to platform failed`** が出るケースがあり、**音声再生系（デバイス側）**は継続調査中。private Pi5 bridge の text 経路は正常（`replyText` 取得済み）。
- 2026-05-11 late: ユーザー観測「音は出るが failed 文言で会話にならない」に対し、Mac からの疎通確認で **`192.168.128.112:18080`（bridge）・`100.89.190.21:22`（private Pi5）・`100.118.82.72:38081`（DGX）同時 timeout** を観測。到達不能時はアプリ不具合判定を停止し、**ネットワーク経路復旧を先行**する運用に切替。
- 2026-05-11 late: 音声安定化としてファーム側を **`mp3` URL健全性チェック + SPIFFS保存再生**へ変更し、`mp3 download bytes=99885 expected=99885` を確認。ダウンロード欠損は抑制できたが、`MP3:ERROR_BUFLEN 0` / `I2S ... failed` は残る回があり、残課題は **I2S ライフサイクル競合**に絞られた。
- 2026-05-11 最終: private Pi5 を **`private_pi5_stt_provider=faster-whisper-local`** で再デプロイし、`POST /api/stackchan/stt` を実運用経路へ昇格。StackChan 側は `CloudSpeechClient.cpp` から raw WAV を同 endpoint へ送る構成に切替え、**WakeWord -> STT -> LLM -> TTS** の会話成立を確認。
- 2026-05-11 最終: デバイス側は `M5Unified 0.2.7` への更新と、`WebVoiceVoxTTS.cpp` の chunked MP3 保存対応により、`I2S ... failed` / `mp3 download bytes=-11 expected=-1` の主再現経路を解消。以後の障害切り分けは、まず `bridge /healthz` と `/api/stackchan/stt` を確認してからデバイス側ログを見る。
- 2026-05-13: **STT（生 WAV）や大きめ POST** で stackchan-bridge が **`request read timeout`** / **`408 REQUEST_TIMEOUT`** を返す場合、**HTTP 受付のソケット読取タイムアウト**（**`STACKCHAN_REQUEST_READ_TIMEOUT_SEC` を正にしたときのみ** `connection.settimeout` が掛かる）が**狭すぎる**ことがある。**未設定・0 では無制限読取**。**30〜120 秒級**へ上げるか、不要なら **0** に戻して `stackchan-bridge` を再起動（**`STT_UPSTREAM_TIMEOUT_SEC` や faster-whisper 推論時間とは別**）。あわせて StackChan 側は **`CHATGPT_API_URL` のビルドフラグ抜け**で OpenAI 既定へ戻り **bridge に chat POST が来ない**ことがある（KB §2026-05-13）。
- 2026-05-13: 音声会話の実用既定として、bridge は **chat 低遅延予算**（`STACKCHAN_CHAT_DEFAULT_MAX_TOKENS=160` / `STACKCHAN_CHAT_MAX_TOKENS_CAP=192` / `STACKCHAN_CHAT_MAX_MESSAGES=8` / `STACKCHAN_CHAT_ALLOW_THINKING=false`）と、**短発話 STT 再試行**（`STT_LOCAL_RETRY_WITHOUT_VAD=true`）を持つ。`faster-whisper-local` が空結果を返す場合は language 自動判定 + VAD 無しで1回再試行し、任意で `STT_LOCAL_FALLBACK_TO_UPSTREAM_ON_EMPTY` により上流 STT へ逃がせる。
- 2026-05-14: **`home_assistant_client.py`** を標準デプロイ対象に追加。**Home Assistant** は **`GET /api/states/<entity>`** で **allowlist された entity だけ**を読み、LLM に **`system`** 文言として載せる（**制御 API は呼ばない**）。環境変数は `.env`/Ansible で `HOME_ASSISTANT_CONTEXT_*`。実機の **ウェイクワード／マイク／オフライン問題** は bridge とは独立に切り分けが必要であり、詳細な引き継ぎ・試行済みワークストリームは [KB-stackchan-community-firmware-supply-chain.md §2026-05-14](../knowledge-base/KB-stackchan-community-firmware-supply-chain.md#2026-05-14-追補-実機ワークストリームウェイクワード登録オフラインモードシリアル本-repo-未コミットの試行含む)·[stackchan-community-text-only-e2e §6.4](../runbooks/stackchan-community-text-only-e2e.md#64-2026-05-14-引き継ぎウェイクワード登録オフラインシリアル) に集約した。

## 関連

- `scripts/private-pi5-stackchan-bridge/README.md`
- `docs/plans/stackchan-private-pi5-tailnet-workflow-plan.md`
- `docs/knowledge-base/KB-stackchan-community-firmware-supply-chain.md`

## 実測記録（2026-05-10・`stackchan_chat_core` 導入後の標準デプロイ）

**前提**: ローカル非追跡の `inventory-private-pi5-stackchan-bridge-fragment.yml` が存在し、`./scripts/private-pi5-stackchan-bridge/deploy-private-pi5-stackchan-bridge.sh` をリポジトリ直下から実行。

**適用リビジョン（記録時点）**: ローカル Git tip **`a27edfc2`**（ブランチ **`feature/stackchan-full-completion`**）。以降 **`main` に取り込まれたらデプロイ引数の ref は `origin/main` HEAD に合わせる**。

**`PLAY RECAP`（抜粋）**:

- `private-pi5-stackchan-bridge`: **`ok=17` `changed=2` `failed=0` `unreachable=0`**

**Playbook で観測された主要変更**:

- `bridge_server.py` / **`stackchan_chat_core.py`** を私用 Pi5 へ同期（`dgx_runtime_client.py` は当該実行では **ファイル内容に変更なし** と playbook が報告）
- handler により **`stackchan-bridge` サービス再起動**
- プレイブック付帯の **`GET /healthz`** は **`200`**、`{"ok": true, "service": "stackchan-private-bridge"}` を確認

**本 Runbook「検証」節に相当する事後確認（Ansible 経由・同一 inventory）**:

```bash
cd infrastructure/ansible
ansible -i inventory-private-pi5-stackchan-bridge-fragment.yml private-pi5-stackchan-bridge \
  -m shell -a 'systemctl is-active stackchan-bridge && curl -fsS http://127.0.0.1:18080/healthz && test -f /home/raspi5-private/stackchan-bridge/stackchan_chat_core.py && echo stackchan_chat_core:ok'
```

**実測結果（2026-05-10 UTC 頃）**:

- `systemctl is-active stackchan-bridge` → **`active`**
- `curl …/healthz` → **`{"ok": true, "service": "stackchan-private-bridge"}`**
- リモートに **`stackchan_chat_core.py` が存在**（インポート境界の実配置確認）

**トラブルシュート（再掲）**:

- デプロイ後に StackChan 側だけが黙る場合は、[stackchan-community-text-only-e2e.md §text-only-done-criteria](./stackchan-community-text-only-e2e.md#text-only-done-criteria) と **IP ミスマッチ** を先に切る。compat alias を playbook で管理している場合は `systemctl status stackchan-bridge-compat-ip.service` と `ip -brief addr show` をセットで見る。
