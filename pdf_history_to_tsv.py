#!/usr/bin/env python3
"""
Suica 残高ご利用明細PDF → TSV変換スクリプト
金額が直接記載されている形式
出力形式: 日付\t件名\t金額
"""
import argparse
import re
from datetime import datetime

import pdfplumber


def fmt_date(d):
    return f"{d.year}/{d.month:02d}/{d.day:02d}"


def fmt_amount(amount):
    if amount >= 0:
        return f"{amount:,}"
    return f"-{abs(amount):,}"


def main():
    parser = argparse.ArgumentParser(description='Suica 残高ご利用明細PDF → TSV変換')
    parser.add_argument('pdf', help='PDFファイルのパス')
    parser.add_argument('--year', '-y', type=int, default=None,
                        help='年 (デフォルト: 現在の年)')
    parser.add_argument('--start-date', '-s', default=None,
                        help='この日以降のみ出力 (形式: YYYY-MM-DD)')
    args = parser.parse_args()

    year = args.year or datetime.now().year
    start_date = None
    if args.start_date:
        start_date = datetime.strptime(args.start_date, '%Y-%m-%d').date()

    records = []

    with pdfplumber.open(args.pdf) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue

            for line in text.split('\n'):
                line = line.strip()
                # 形式: MM DD 種別 [情報] \残高 [+-]金額
                m = re.match(r'^(\d{2}) (\d{2}) (.+?) \\[\d,]+ ([+-][\d,]+)$', line)
                if not m:
                    continue

                month, day, info, amount_str = m.groups()
                amount = int(amount_str.replace(',', ''))
                d = datetime(year, int(month), int(day)).date()
                if start_date and d < start_date:
                    continue
                info = info.strip()

                # 入 XX 出 YY → 件名を整形
                m2 = re.match(r'入 (.+?) 出 (.+)', info)
                if m2:
                    name = f"電車({m2.group(1)}→{m2.group(2)})"
                else:
                    name = info

                records.append((d, name, amount))

    records.sort(key=lambda x: x[0])

    print("日付\t件名\t金額")
    for d, name, amount in records:
        print(f"{fmt_date(d)}\t{name}\t{fmt_amount(amount)}")


if __name__ == '__main__':
    main()
