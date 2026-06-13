# DGX Spark private ComfyUI — baseline workflows

運用の **基準線** workflow JSON をリポジトリで版管理する。

| ファイル | 状態 |
|----------|------|
| `phase1_qwen_edit_2511_dgx_flat.json` | **Phase 1 正本**（2026-06-13）。Qwen Image Edit 2511 公式テンプレートの単一画像編集フラット版。bf16 UNET + Lightning 4step img2img。プロンプト編集検証済み |
| `0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json` | **FLUX txt2img+参照 基準線**（2026-05-31）。DGX 上に実在するモデルのみ参照。画像編集用途ではない |
| `0607_flux2_klein_two_reference_no_snofs_initial.json` | **初期実験**（2026-06-07）。人物参照 + 衣装/ポーズ参照を分ける。SNOFS は意図的に未使用 |
| `0607_flux2_klein_two_reference_weighted_stock_v2.json` | **stock 調整実験**。ID 参照を弱め、衣装/ポーズ参照を強める。追加ノード不要 |
| `0607_flux2_klein_outfit_first_identity_late_stock_v3.json` | **stock 段階分離実験**。1段目は衣装/ポーズのみ、2段目の低シグマだけ ID 参照 |
| `0607_flux2_klein_outfit_base_identity_mid_stock_v4.json` | **stock 中間案**。1段目は衣装/ポーズ、2段目は衣装/ポーズを残して ID 参照を中盤から追加 |
| `0607_flux2_klein_reference_latent_plus_masked_v2.json` | **追加ノード実験**。ReferenceLatentPlus で ID は顔/髪・後半、衣装/ポーズは体/服/背景・強めに分離 |
| `0607_flux2_klein_pulid_identity_reflatentplus_outfit_v1.json` | **本命分離案**。ID は PuLID 専用、衣装/ポーズは ReferenceLatentPlus 専用。SNOFS 未使用 |
| `0607_qwen_image_edit_2511_spark_fast_baseline_4step.json` | **Qwen 2 画像・実行確認済み**（2026-06-07）。fp8mixed + Lightning 4step。Phase 1 完成後は `phase1_…` を優先 |
| `0607_qwen_image_edit_2511_spark_quality_fp8mixed_20step.json` | **Spark 品質確認案・未実行**。20step。Lightning 無効 |
| `0607_qwen_image_edit_2511_spark_hq_bf16text_40step.json` | **Spark 高品質案（モデル取得未完了）**。bf16 + 40step。Lightning 無効 |

**2026-06-12 着せ替え / candidate 系**（tryon v1–v3、candidate A/B/C 等）は Phase 1 方向転換により **リポジトリから削除**。失敗理由は [KB-379](../../../docs/knowledge-base/KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md) §2026-06-12〜13。

正本ドキュメント: [KB-379](../../../docs/knowledge-base/KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md)

**インポート先（DGX コンテナ）**: `/opt/ComfyUI/user/default/workflows/`（Mac 管理 SSH 経由で `docker cp` 配置）
