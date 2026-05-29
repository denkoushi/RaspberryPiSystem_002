---
title: 私用 Pi5 Hermes 小説創作プロファイル ExecPlan
tags: [Hermes Agent, private Pi5, novel profile, DGX model profile, Discord]
audience: [開発者, 運用者]
last-verified: 2026-05-29
related:
  - private-pi5-hermes-agent-plan.md
  - private-pi5-hermes-butler-vision-and-roadmap.md
  - ../runbooks/private-pi5-hermes-deploy.md
  - ../../scripts/private-pi5-hermes/README.md
  - ../../scripts/dgx-local-llm-system/README.md
  - ./dgx-uncensored-profile-button.md
category: plans
update-frequency: medium
---

# 私用 Pi5 Hermes 小説創作プロファイル ExecPlan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

私用 Pi5 の Hermes に、既存の **Discord 雑談 chat** と **file/web/browser tools** とは別の、**小説創作専用 profile** を追加する。完了後は、Discord から明示コマンドで **小説創作用 `novel` プロファイル**へ委譲し、DGX の **`qwen36_35b_uncensored`** を起動して長文生成できる。既存の chat は短文雑談のまま、tools は file/web/browser 作業のまま維持し、責務を混ぜない。

ユーザーが実感できる変化は次の 2 点である。第一に、既存 Discord 入口から **`/novel`** のような明示コマンドで長文創作を呼べる。第二に、その処理は private Pi5 側で **専用 HOME / 専用 `.env` / 専用 system prompt / 専用 max_tokens** を持つ isolated profile に分離され、DGX では `modelProfileId=qwen36_35b_uncensored` を指定して起動するため、雑談 chat の 128 token 制約や業務 profile と混ざらない。

## Progress

- [x] (2026-05-29 20:10 JST) 現行 Hermes / DGX / docs を再調査し、既存責務が `chat` と `tools` に明確分離されていることを確認した。
- [x] (2026-05-29 20:12 JST) feature ブランチ `feat/private-pi5-hermes-novel-profile` を作成した。
- [x] (2026-05-29 20:14 JST) 実装方針を **第3プロファイル `novel` + 明示 `/novel` bridge** に確定した。
- [x] `novel` profile の spec / path / Ansible 配備を追加する。
- [x] DGX ready/start クライアントに `modelProfileId` 指定起動を追加し、Hermes novel profile が `qwen36_35b_uncensored` を要求できるようにする。
- [x] Discord plugin に `/novel` bridge を追加し、既存 `/task` と責務分離する。
- [x] テスト・smoke・Ansible verify を追加して、chat / tools の非回帰を確認する。
- [x] Runbook / README / 本 ExecPlan を更新し、実装完了で停止する（コミット・push はしない）。

## Surprises & Discoveries

- Observation: 既存 Hermes は `chat` と `tools` の 2 系統が strong boundary で分離されており、`/task` は D5/D5.1 の承認 relay と file/web/browser 前提に最適化されている。
  Evidence: `scripts/private-pi5-hermes/lib/profiles.py`, `infrastructure/ansible/tasks/private-pi5-hermes/deploy-tools-profile.yml`, `scripts/private-pi5-hermes/lib/discord_task_bridge_plugin.py`

- Observation: private Pi5 側の keep-warm / runtime start クライアントは `POST /start {}` のみで、まだ `modelProfileId` 指定 start を持っていない。
  Evidence: `scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py`

- Observation: 過去の設計会話では「小説創作は Hermes の第3プロファイル `novel / creative` として分ける」が既に合意されている。
  Evidence: 親 transcript の 2026-05-29 対話ログで「小説は第3プロファイル『novel / creative』として足すイメージが自然」と整理済み。

## Decision Log

- Decision: 小説用途は既存 `chat` を流用せず、**第3プロファイル `novel`** として追加する。
  Rationale: `chat` は短文雑談・Discord 入口・ツール無効に最適化されている一方、`tools` は file/web/browser と承認 relay に最適化されている。小説創作は「長文生成 + 専用 prompt + DGX model profile 起動」が責務であり、どちらにも自然に収まらない。第3プロファイルなら単一責務を守れる。
  Date/Author: 2026-05-29 / GPT-5.4

- Decision: Discord 入口は既存 `hermes-gateway` を再利用し、**明示 `/novel` bridge** で `novel` profile に委譲する。
  Rationale: 新しい Bot や別 gateway を増やすより運用が軽く、既存 Discord allowlist・plugin 配備・session 文脈を再利用できる。雑談と創作をコマンドで明示分離でき、誤作動も少ない。
  Date/Author: 2026-05-29 / GPT-5.4

- Decision: DGX 起動は `POST /start {"modelProfileId":"qwen36_35b_uncensored"}` を private Pi5 側クライアントに追加して扱う。
  Rationale: 単に Hermes 側 config の `model.default` を変えても、DGX 上の active model が別 profile のままなら小説用途の保証がない。private Pi5 側で start と ready の両方を制御する必要がある。
  Date/Author: 2026-05-29 / GPT-5.4

## Outcomes & Retrospective

未記入。実装完了後に、何が動くようになったか、chat / tools 非回帰、残課題（実機 deploy など）を追記する。

## Context and Orientation

このリポジトリの Hermes は、**私用 Pi5** 上で動く私的ユース用エージェントであり、職場 Pi5 API や工場 UI とは別系統である。現在は次の 2 プロファイルがある。

1. **chat profile**  
   パスは `/home/hermes/.hermes`。systemd unit は `hermes-gateway`。Discord からの雑談専用で、`max_tokens=128`、短文 prompt、すべての toolsets が disabled。定義は `infrastructure/ansible/templates/private-pi5-hermes/config.chat.yaml.j2`。

2. **tools profile**  
   パスは `/home/hermes/.hermes-tools`。isolated HOME は `/home/hermes/.hermes-tools/home`。systemd unit は `hermes-tools-gateway`。D1→D4 の段階で file/web/browser を増やし、D5/D5.1 で `/task` と approval relay が付いている。定義は `infrastructure/ansible/templates/private-pi5-hermes/config.tools.yaml.j2` と `scripts/private-pi5-hermes/lib/tools_profile_runner.py`。

DGX 側は `scripts/dgx-local-llm-system/model_profiles.py` により `modelProfileId` から manifest を解決し、`POST /start {"modelProfileId":"..."}` で active profile を切り替える。`qwen36_35b_uncensored` はすでに DGX に登録済みで、manifest は `scripts/dgx-local-llm-system/model-registry.examples/qwen36_35b_uncensored/manifest.json` にある。職場 Pi5 の DGX Resource ボタンから起動できるが、**Hermes private Pi5 はまだこの profile 指定 start に未対応**である。

今回追加する `novel` profile は、**小説創作専用**であり、次の条件を満たす。

- Discord 雑談 `chat` の短文設定を壊さない。
- file/web/browser 作業 `tools` と責務を混ぜない。
- DGX active model を `qwen36_35b_uncensored` に揃えられる。
- 性的ニュアンスを含む創作表現を、Hermes 側のネットワーク境界や承認とは独立に扱える。

## Plan of Work

最初に、Hermes profile metadata を `scripts/private-pi5-hermes/lib/profiles.py` と `profile_spec.py` ベースで拡張し、`novel` のデータディレクトリ、systemd unit、Discord 利用可否、toolsets 無効状態を定義する。ここでは `chat` と同じく **Discord は有効**、**tools は無効**だが、`max_tokens` と system prompt と DGX 起動 profile が異なる profile として表現する。

次に、Ansible playbook `infrastructure/ansible/playbooks/private-pi5-hermes.yml` に `novel` profile の変数と deploy/verify 手順を追加する。既存の `deploy-chat-profile.yml` と `deploy-tools-profile.yml` を壊さないため、新規 `deploy-novel-profile.yml` と必要なら `verify-novel-profile.yml` を追加し、config / `.env` / systemd unit を分離する。systemd unit は `hermes-novel-gateway` とし、HOME は isolated にするが、plugin は chat と同様に Discord 入口から使える前提で配備する。

そのうえで、DGX upstream client `scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py` に **optional `model_profile_id`** を加える。`warm_runtime_if_needed()` と `ensure_runtime_ready()` が、設定されていれば `POST /start {"modelProfileId": "..."} ` を送るようにする。Hermes keep-warm は既存 chat を守るため既定動作を維持し、novel profile だけが新しい env 変数で `qwen36_35b_uncensored` を指定できるようにする。

Discord bridge は既存 `/task` plugin と混ぜず、`scripts/private-pi5-hermes/lib/discord_task_bridge_plugin.py` か新規 plugin module に **`/novel`** コマンドを追加する。ここでは file/web/browser は使わず、代わりに `novel` isolated HOME / `.env` で `hermes chat -q` を呼ぶ軽い runner を実装する。`/task` が作業系、`/novel` が創作系であることを system prompt と usage text で明示する。

最後に、テストを profile metadata・runner・config contract・DGX client に追加する。`chat` と `tools` の既存テストを更新し、`novel` が新しい profile として registry に現れること、Ansible で config が正しくレンダリングされること、`modelProfileId` 付き start JSON を生成することを確認する。ローカルでは unittest と ansible syntax-check を通し、必要なら smoke スクリプトを 1 本追加する。

## Concrete Steps

作業ディレクトリはリポジトリルート ` /Users/tsudatakashi/RaspberryPiSystem_002 ` とする。

1. profile metadata 拡張後、以下を実行して profile registry テストを確認する。

    python3 -m unittest scripts/private-pi5-hermes/tests/test_profiles.py
    python3 -m unittest scripts/private-pi5-hermes/tests/test_profile_phase.py

2. DGX client の `modelProfileId` start 対応後、client 単体テストまたは追加 test を実行する。

    python3 -m unittest discover -s scripts/private-pi5-hermes/tests -p 'test_*.py'

3. Ansible task / template を追加後、syntax-check と verify contract を確認する。

    cd infrastructure/ansible
    ansible-playbook playbooks/private-pi5-hermes.yml --syntax-check -i inventory-private-pi5-stackchan-bridge-fragment.sample.yml

4. bridge / runner 実装後、smoke を回す。

    ./scripts/private-pi5-hermes/verify-discord-task-bridge-smoke.sh

必要なら novel 専用 smoke を追加し、次のような期待値を用意する。

    - `/novel` の空入力は usage を返して exit 1
    - `novel` runner は isolated HOME `/home/hermes/.hermes-novel/home` を使う
    - DGX start payload は `{"modelProfileId":"qwen36_35b_uncensored"}` を含む

## Validation and Acceptance

ローカル acceptance は次の振る舞いで判定する。

- `test_profiles.py` で `novel` profile が registry に追加され、`chat` / `tools` の既存期待を壊していない。
- `dgx_runtime_client.py` の新テストで `modelProfileId` 付き start body が生成される。未設定時は従来の空 body を維持する。
- `config.chat.yaml.j2` / `config.tools.yaml.j2` の既存 contract test が通り、新しい `config.novel.yaml.j2` に対する test で長文生成向け設定（高めの `max_tokens`、創作向け prompt、toolsets disabled）が確認できる。
- plugin / runner テストで `/novel` が file/web/browser を介さず novel profile へ委譲される。

人が確認できる acceptance は、将来の実機デプロイ時に次のようになることを目標とする。

- Discord で `/novel プロットを考えて` と送ると、既存雑談ではなく novel profile が処理し、長めの創作出力が返る。
- 同時に `chat` の通常メッセージは 2〜4 文の短文雑談のまま。
- `tools` の `/task` は従来どおり file/web/browser と承認 relay を使う。

## Idempotence and Recovery

この計画の変更はすべて additive に行う。既存 `chat` / `tools` ファイルは削除せず、新しい `novel` 用 template・task・profile spec を追加する。もし novel profile 実装が途中で失敗しても、feature ブランチ上で未完成の差分として留まり、既存 main の deploy 手順は壊れない。

Ansible では新規 `private_pi5_hermes_novel_*` 変数が未設定なら `novel` profile を起動しない既定にする。これにより inventory fragment が更新されるまで本番影響を避けられる。Discord bridge も `novel` フラグが false のときは command を登録しない設計にする。

## Artifacts and Notes

実装中に参照する重要な既存ファイル:

    scripts/private-pi5-hermes/lib/profiles.py
    scripts/private-pi5-hermes/lib/tools_profile_runner.py
    scripts/private-pi5-hermes/lib/discord_task_bridge_plugin.py
    scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py
    infrastructure/ansible/playbooks/private-pi5-hermes.yml
    infrastructure/ansible/templates/private-pi5-hermes/config.chat.yaml.j2
    infrastructure/ansible/templates/private-pi5-hermes/config.tools.yaml.j2

過去合意の要点:

    - 小説創作は private Pi5 経由が筋で、職場 Pi5 API に混ぜない。
    - Hermes は性的ニュアンスそのものを block する層ではない。
    - 小説用途は chat の短文雑談設定を流用せず、第3 profile `novel / creative` として分ける。

## Interfaces and Dependencies

このマイルストーン完了時に、少なくとも次の interface が存在すること。

`scripts/private-pi5-hermes/lib/profiles.py`

    NOVEL_PROFILE = HermesProfileSpec(
        name="novel",
        data_dir_name="hermes-novel",
        systemd_unit="hermes-novel-gateway",
        discord_enabled=True,
        tools_enabled=False,
        enabled_toolsets=frozenset(),
        expected_gateway_active=...
    )

`scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py`

    @dataclass(frozen=True)
    class DgxUpstreamConfig:
        ...
        model_profile_id: str = ""

    def ensure_runtime_ready(self) -> tuple[bool, dict[str, Any]]:
        # model_profile_id があれば POST /start body に含める

`scripts/private-pi5-hermes/lib/discord_task_bridge_plugin.py` または新規 module

    async def _handle_novel_command(raw_args: str) -> str:
        ...

Ansible 側には novel 用の config / env / systemd / verify task が追加され、inventory flag は `private_pi5_hermes_novel_profile_enabled` を正本とする。

## Revision Notes

2026-05-29: 初版作成。既存 Hermes chat/tools と DGX model profile の現仕様を読み直し、`novel` を第3プロファイルとして追加する方針を計画に固定した。
