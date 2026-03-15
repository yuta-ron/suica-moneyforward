#!/usr/bin/env python3
"""
Suica 開示等請求PDF → TSV変換スクリプト
残額の差分で金額を計算する
出力形式: 日付\t件名\t金額
"""
import argparse
import re
from datetime import datetime

import pdfplumber

DAYS_JP = ['月', '火', '水', '木', '金', '土', '日']


def fmt_date(d):
    return f"{d.year}/{d.month:02d}/{d.day:02d}"


def fmt_amount(amount):
    if amount >= 0:
        return f"{amount:,}"
    return f"-{abs(amount):,}"


def main():
    parser = argparse.ArgumentParser(description='Suica 開示等請求PDF → TSV変換')
    parser.add_argument('pdf', help='PDFファイルのパス')
    parser.add_argument('--password', '-p', default=None, help='PDFのパスワード')
    args = parser.parse_args()

    records = []
    prev_balance = None

    with pdfplumber.open(args.pdf, password=args.password) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue

            for line in text.split('\n'):
                line = line.strip()
                # 形式: YYYY/M/D H:MM 種別 [情報] 残額
                m = re.match(r'(\d{4}/\d+/\d+) (\d+:\d+) (.+?) (\d+)$', line)
                if not m:
                    continue

                date_str, time_str, info, balance_str = m.groups()
                balance = int(balance_str)
                info = info.strip()

                if prev_balance is not None:
                    amount = balance - prev_balance
                    if amount != 0:
                        d = datetime.strptime(date_str, '%Y/%m/%d').date()

                        # 入 XX 出 YY → 件名を整形
                        m2 = re.match(r'入 (.+?) 出 (.+)', info)
                        if m2:
                            name = f"電車({m2.group(1)}→{m2.group(2)})"
                        else:
                            name = info

                        records.append((d, name, amount))

                prev_balance = balance

    records.sort(key=lambda x: x[0])

    print("日付\t件名\t金額")
    for d, name, amount in records:
        print(f"{fmt_date(d)}\t{name}\t{fmt_amount(amount)}")


if __name__ == '__main__':
    main()
