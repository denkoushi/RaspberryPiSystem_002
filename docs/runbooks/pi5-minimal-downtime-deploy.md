---
title: Pi5標準Ansible移行ノート
status: superseded
scope: historical Pi5 deployment design notes
date: 2026-08-08
source_of_truth: docs/guides/deployment.md
related_docs: [../guides/deployment.md, ./pi5-blue-green-deploy.md]
---

# Pi5標準Ansible移行ノート

この文書は旧Pi5 image deployment設計の移行ノートであり、現役手順ではない。実行時は [デプロイメントガイド](../guides/deployment.md) と [Pi5標準Ansible診断Runbook](./pi5-blue-green-deploy.md)を使用する。

現行のPi5処理は `scripts/update-all-clients.sh` から `scripts/deploy/standard-ansible-release.py`、`deploy-release-standard.yml`、`release_pi5` roleへ進む。image、migration、health、slot切替、rollbackはrole内のAnsible taskが所有する。
