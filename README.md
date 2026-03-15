# suica-moneyforward

Suica の PDF 明細を MoneyForward ME に自動登録するツール。

## 概要

1. Suica の利用履歴 PDF を TSV に変換（Python）
2. TSV を読み込んで MoneyForward ME に Playwright で自動入力（TypeScript）

## 必要なもの

- Node.js
- Python 3 + [pdfplumber](https://github.com/jsvine/pdfplumber)
- Playwright（Chromium）

```bash
npm install
pip install pdfplumber
npx playwright install chromium
```

## セットアップ

`.env.example` をコピーして `.env` を作成し、MoneyForward のメールアドレスとパスワードを設定する。

```bash
cp .env.example .env
```

## 使い方

### Step 1: PDF → TSV 変換

Suica の PDF 種別に応じてスクリプトを選択する。

**開示等請求で取得したPDF**（残額の差分から金額を算出、パスワード付き）

```bash
python pdf_disclosure_to_tsv.py <PDFファイル> --password <パスワード> > result.tsv
```

**モバイルSuicaのマイページからダウンロードした残高ご利用明細 PDF**（金額が直接記載）

```bash
python pdf_history_to_tsv.py <PDFファイル> --year 2026 > result.tsv

# 特定日以降のみ出力する場合
python pdf_history_to_tsv.py <PDFファイル> --year 2026 --start-date 2026-02-24 > result.tsv
```

### Step 2: MoneyForward ME に登録

```bash
npm run import
```

ブラウザが起動し、未ログイン時はメールアドレス・パスワードの入力、OTP が要求された場合はターミナルで手動入力する。
登録対象は支出（マイナス金額）のみ。チャージ・入金はスキップされる。

## カテゴリ判定

| 件名のプレフィックス | 大カテゴリ | 小カテゴリ |
|---|---|---|
| `電車` | 交通費 | 電車 |
| `バス` | 交通費 | バス |
| その他 | 食費 | — |

## ファイル構成

```
.
├── src/
│   └── import-tsv.ts        # MoneyForward ME 自動登録スクリプト
├── pdf_disclosure_to_tsv.py # 開示等請求PDF → TSV
├── pdf_history_to_tsv.py    # 残高ご利用明細PDF → TSV
├── state/                   # セッション・重複管理データ（.gitignore対象）
├── .env.example
├── package.json
└── tsconfig.json
```
