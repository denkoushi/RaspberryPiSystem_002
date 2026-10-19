/**
 * Initial field tree for knowledge topics (owner-approved 2026-10-04). Built from public machining vocabulary,
 * pruned by what the shop's machine master and work instructions actually contain. Seeded only into an empty
 * table; people curate it afterwards. Names are unique across the tree and include every initial work type.
 */
export type KnowledgeFieldSeed = { name: string; aliases: string[]; children: KnowledgeFieldSeed[] };

export const INITIAL_KNOWLEDGE_FIELDS: KnowledgeFieldSeed[] = [
  {
    "name": "加工",
    "aliases": [],
    "children": [
      {
        "name": "切削",
        "aliases": [
          "機械加工"
        ],
        "children": [
          {
            "name": "フライス・マシニング",
            "aliases": [
              "MC",
              "マシニングセンター",
              "フライス盤"
            ],
            "children": []
          },
          {
            "name": "5軸・5面加工",
            "aliases": [
              "5軸加工機",
              "五面加工機"
            ],
            "children": []
          },
          {
            "name": "旋削",
            "aliases": [
              "旋盤",
              "CNC旋盤",
              "NC旋盤"
            ],
            "children": []
          },
          {
            "name": "穴あけ・タップ",
            "aliases": [
              "ボール盤",
              "ドリル",
              "ねじ切り",
              "リーマ"
            ],
            "children": []
          },
          {
            "name": "鋸切断",
            "aliases": [
              "帯鋸",
              "切断機"
            ],
            "children": []
          },
          {
            "name": "切削条件",
            "aliases": [
              "回転数",
              "送り",
              "切込み"
            ],
            "children": []
          },
          {
            "name": "加工手順",
            "aliases": [
              "工程順",
              "加工順序"
            ],
            "children": []
          },
          {
            "name": "NCプログラム",
            "aliases": [
              "プログラム",
              "Gコード",
              "CAM"
            ],
            "children": []
          }
        ]
      },
      {
        "name": "研削",
        "aliases": [
          "研磨"
        ],
        "children": [
          {
            "name": "平面研削",
            "aliases": [
              "平研",
              "平面研削盤"
            ],
            "children": []
          },
          {
            "name": "円筒研削",
            "aliases": [
              "円研",
              "円筒研削盤"
            ],
            "children": []
          },
          {
            "name": "砥石・ドレス",
            "aliases": [
              "ドレッシング",
              "砥石交換"
            ],
            "children": []
          },
          {
            "name": "研削条件",
            "aliases": [],
            "children": []
          }
        ]
      },
      {
        "name": "板金・曲げ",
        "aliases": [
          "ベンダー"
        ],
        "children": [
          {
            "name": "曲げ",
            "aliases": [
              "プレスブレーキ",
              "ベンダー"
            ],
            "children": []
          },
          {
            "name": "板金の切断",
            "aliases": [
              "シャーリング"
            ],
            "children": []
          }
        ]
      },
      {
        "name": "仕上げ",
        "aliases": [],
        "children": [
          {
            "name": "バリ取り・面取り",
            "aliases": [
              "糸面",
              "C面"
            ],
            "children": []
          },
          {
            "name": "刻印・マーキング",
            "aliases": [
              "打刻"
            ],
            "children": []
          },
          {
            "name": "洗浄",
            "aliases": [
              "脱脂"
            ],
            "children": []
          }
        ]
      },
      {
        "name": "表面処理・熱処理",
        "aliases": [
          "外注処理"
        ],
        "children": [
          {
            "name": "塗装",
            "aliases": [],
            "children": []
          },
          {
            "name": "めっき",
            "aliases": [
              "カニゼン",
              "無電解ニッケル",
              "メッキ"
            ],
            "children": []
          },
          {
            "name": "熱処理",
            "aliases": [
              "焼入れ",
              "焼戻し"
            ],
            "children": []
          }
        ]
      }
    ]
  },
  {
    "name": "段取り",
    "aliases": [
      "セットアップ",
      "段取"
    ],
    "children": [
      {
        "name": "取付・クランプ",
        "aliases": [
          "ワーク取付"
        ],
        "children": [
          {
            "name": "チャック・爪",
            "aliases": [
              "生爪",
              "三つ爪"
            ],
            "children": []
          },
          {
            "name": "バイス",
            "aliases": [
              "万力"
            ],
            "children": []
          },
          {
            "name": "治具取付",
            "aliases": [],
            "children": []
          },
          {
            "name": "吊り・搬入",
            "aliases": [
              "玉掛け",
              "ワーク搬入"
            ],
            "children": []
          }
        ]
      },
      {
        "name": "芯出し・原点",
        "aliases": [],
        "children": [
          {
            "name": "芯出し",
            "aliases": [
              "心出し",
              "センタリング"
            ],
            "children": []
          },
          {
            "name": "原点合わせ",
            "aliases": [
              "ワーク座標",
              "原点出し"
            ],
            "children": []
          },
          {
            "name": "平行・直角出し",
            "aliases": [
              "平行出し",
              "直角出し"
            ],
            "children": []
          }
        ]
      },
      {
        "name": "治具・工具",
        "aliases": [],
        "children": [
          {
            "name": "治具",
            "aliases": [
              "ジグ",
              "取付具"
            ],
            "children": []
          },
          {
            "name": "刃具・チップ",
            "aliases": [
              "インサート",
              "エンドミル",
              "工具交換"
            ],
            "children": []
          },
          {
            "name": "工具補正・工具長",
            "aliases": [
              "工具長測定",
              "径補正"
            ],
            "children": []
          }
        ]
      }
    ]
  },
  {
    "name": "検査・測定",
    "aliases": [
      "検査",
      "測定"
    ],
    "children": [
      {
        "name": "寸法測定",
        "aliases": [],
        "children": [
          {
            "name": "外径・内径",
            "aliases": [],
            "children": []
          },
          {
            "name": "穴・ねじ",
            "aliases": [
              "ねじゲージ",
              "ピンゲージ"
            ],
            "children": []
          },
          {
            "name": "平行・直角・振れ",
            "aliases": [
              "幾何公差"
            ],
            "children": []
          },
          {
            "name": "表面粗さ",
            "aliases": [
              "面粗度"
            ],
            "children": []
          }
        ]
      },
      {
        "name": "測定機器",
        "aliases": [
          "計測機器"
        ],
        "children": [
          {
            "name": "三次元測定機",
            "aliases": [
              "CMM",
              "三次元"
            ],
            "children": []
          },
          {
            "name": "ノギス・マイクロメータ",
            "aliases": [
              "マイクロ"
            ],
            "children": []
          },
          {
            "name": "ゲージ",
            "aliases": [
              "ブロックゲージ",
              "栓ゲージ"
            ],
            "children": []
          },
          {
            "name": "校正・点検",
            "aliases": [
              "校正"
            ],
            "children": []
          }
        ]
      },
      {
        "name": "自主検査",
        "aliases": [],
        "children": [
          {
            "name": "記録の付け方",
            "aliases": [],
            "children": []
          },
          {
            "name": "判定基準",
            "aliases": [
              "合否"
            ],
            "children": []
          }
        ]
      },
      {
        "name": "受入・出荷検査",
        "aliases": [
          "受入検査",
          "出荷検査"
        ],
        "children": []
      }
    ]
  },
  {
    "name": "組立",
    "aliases": [
      "組み立て",
      "組付け"
    ],
    "children": [
      {
        "name": "締付・トルク",
        "aliases": [
          "トルクレンチ",
          "締め付け"
        ],
        "children": []
      },
      {
        "name": "圧入・はめあい",
        "aliases": [
          "ベアリング圧入"
        ],
        "children": []
      },
      {
        "name": "組立手順",
        "aliases": [],
        "children": []
      },
      {
        "name": "配線・配管",
        "aliases": [],
        "children": []
      },
      {
        "name": "調整・試運転",
        "aliases": [],
        "children": []
      }
    ]
  },
  {
    "name": "設備・保全",
    "aliases": [
      "設備",
      "メンテナンス"
    ],
    "children": [
      {
        "name": "保全・点検",
        "aliases": [],
        "children": [
          {
            "name": "日常点検",
            "aliases": [
              "始業点検"
            ],
            "children": []
          },
          {
            "name": "給油・クーラント",
            "aliases": [
              "切削油",
              "潤滑油"
            ],
            "children": []
          },
          {
            "name": "清掃・切粉処理",
            "aliases": [
              "切粉",
              "チップコンベア"
            ],
            "children": []
          },
          {
            "name": "定期点検",
            "aliases": [],
            "children": []
          }
        ]
      },
      {
        "name": "トラブル対応",
        "aliases": [],
        "children": [
          {
            "name": "アラーム・復旧",
            "aliases": [
              "エラー",
              "非常停止"
            ],
            "children": []
          },
          {
            "name": "故障・修理依頼",
            "aliases": [],
            "children": []
          }
        ]
      },
      {
        "name": "設備の操作",
        "aliases": [],
        "children": [
          {
            "name": "起動・停止",
            "aliases": [
              "暖機"
            ],
            "children": []
          },
          {
            "name": "操作盤・NC操作",
            "aliases": [],
            "children": []
          }
        ]
      }
    ]
  },
  {
    "name": "品質",
    "aliases": [],
    "children": [
      {
        "name": "不適合・手戻り",
        "aliases": [
          "不良",
          "手直し"
        ],
        "children": [
          {
            "name": "原因と対策",
            "aliases": [],
            "children": []
          },
          {
            "name": "再発防止",
            "aliases": [],
            "children": []
          },
          {
            "name": "処置の手順",
            "aliases": [],
            "children": []
          }
        ]
      },
      {
        "name": "図面・規格",
        "aliases": [],
        "children": [
          {
            "name": "図面の読み方",
            "aliases": [],
            "children": []
          },
          {
            "name": "公差・はめあい",
            "aliases": [],
            "children": []
          },
          {
            "name": "材料・材質",
            "aliases": [
              "材質"
            ],
            "children": []
          }
        ]
      },
      {
        "name": "変更・特採",
        "aliases": [
          "設計変更",
          "特別採用"
        ],
        "children": []
      }
    ]
  },
  {
    "name": "安全・環境",
    "aliases": [],
    "children": [
      {
        "name": "安全",
        "aliases": [],
        "children": [
          {
            "name": "保護具",
            "aliases": [
              "保護メガネ",
              "安全靴"
            ],
            "children": []
          },
          {
            "name": "危険予知・ヒヤリハット",
            "aliases": [
              "KY"
            ],
            "children": []
          },
          {
            "name": "吊り作業・クレーン",
            "aliases": [
              "玉掛け",
              "ホイスト"
            ],
            "children": []
          },
          {
            "name": "化学物質・油剤",
            "aliases": [
              "SDS"
            ],
            "children": []
          }
        ]
      },
      {
        "name": "5S・環境",
        "aliases": [],
        "children": [
          {
            "name": "整理整頓",
            "aliases": [],
            "children": []
          },
          {
            "name": "廃棄・分別",
            "aliases": [
              "産廃"
            ],
            "children": []
          }
        ]
      }
    ]
  },
  {
    "name": "事務・教育",
    "aliases": [],
    "children": [
      {
        "name": "申し込み・手続き",
        "aliases": [],
        "children": [
          {
            "name": "休暇・勤怠",
            "aliases": [
              "有給"
            ],
            "children": []
          },
          {
            "name": "経費・購買",
            "aliases": [],
            "children": []
          },
          {
            "name": "各種申請",
            "aliases": [],
            "children": []
          }
        ]
      },
      {
        "name": "教育・技能",
        "aliases": [],
        "children": [
          {
            "name": "技能検定",
            "aliases": [],
            "children": []
          },
          {
            "name": "資格・免許",
            "aliases": [],
            "children": []
          },
          {
            "name": "新人教育・OJT",
            "aliases": [],
            "children": []
          },
          {
            "name": "社内ルール",
            "aliases": [],
            "children": []
          }
        ]
      },
      {
        "name": "生産管理",
        "aliases": [],
        "children": [
          {
            "name": "日程・納期",
            "aliases": [],
            "children": []
          },
          {
            "name": "移動票・実績入力",
            "aliases": [],
            "children": []
          },
          {
            "name": "外注・購買",
            "aliases": [],
            "children": []
          }
        ]
      },
      {
        "name": "システムの使い方",
        "aliases": [],
        "children": [
          {
            "name": "キオスク",
            "aliases": [],
            "children": []
          },
          {
            "name": "計測機器・工具の貸出",
            "aliases": [],
            "children": []
          }
        ]
      }
    ]
  },
  {
    "name": "その他",
    "aliases": [],
    "children": []
  }
];
