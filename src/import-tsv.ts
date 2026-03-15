import fs from "fs";
import path from "path";
import * as readline from "readline";
import { chromium } from "playwright";

const TSV_PATH = path.resolve(process.cwd(), "result.tsv");
const MF_URL = "https://moneyforward.com/";
const MF_CF_URL = "https://moneyforward.com/cf";
const MF_LOGIN_URL = "https://moneyforward.com/sign_in";
const INTERVAL_MS = 2000;

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    process.env[key] ??= val;
  }
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

interface TsvRow {
  date: string;
  subject: string;
  amount: number;
}

function parseTsv(filePath: string): TsvRow[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  const rows: TsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    if (cols.length < 3) continue;

    const date = cols[0].trim();
    const subject = cols[1].trim();
    const amountStr = cols[2].trim().replace(/,/g, "");
    const amount = parseInt(amountStr, 10);

    if (!date || isNaN(amount)) continue;
    rows.push({ date, subject, amount });
  }

  return rows;
}

/** 件名からカテゴリ（大・小）を判定 */
function getCategory(subject: string): { large: string; small: string | null; middleId: string | null } {
  if (subject.startsWith("電車")) {
    return { large: "交通費", small: "電車", middleId: null };
  }
  if (subject.startsWith("バス") || subject.startsWith("ﾊﾞｽ")) {
    return { large: "交通費", small: "バス", middleId: null };
  }
  return { large: "食費", small: null, middleId: "105" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  loadEnv();
  const rows = parseTsv(TSV_PATH);

  // 支出のみ登録（正の金額 = チャージ・入金はスキップ）
  const expenses = rows.filter((r) => r.amount < 0);
  const incomes = rows.filter((r) => r.amount > 0);
  console.log(`TSV読み込み完了: 全${rows.length}件中 支出${expenses.length}件を登録します`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const email = process.env.MF_EMAIL;
  const password = process.env.MF_PASSWORD;
  if (!email || !password) {
    console.error(".env に MF_EMAIL / MF_PASSWORD が設定されていません");
    await browser.close();
    process.exit(1);
  }

  // /cf を開いてログイン状態を確認（未ログイン時は確実に id.moneyforward.com へリダイレクトされる）
  await page.goto(MF_CF_URL, { waitUntil: "domcontentloaded" });
  await sleep(2000);

  const needsLogin = page.url().includes("id.moneyforward.com");
  if (needsLogin) {
    console.log("ログイン中...");

    // account_selector の場合はアカウントボタンをクリック → password ページへ
    if (page.url().includes("account_selector")) {
      const accountBtn = page.locator(`button:has-text("${email}")`);
      if (await accountBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }),
          accountBtn.click(),
        ]);
      } else {
        // 別アカウントリンクをクリックしてメール入力画面へ
        await page.click('a:has-text("Use other accounts"), a:has-text("別のアカウント")');
        await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
        await page.fill('input[type="email"], input[name="email"]', email);
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }),
          page.keyboard.press("Enter"),
        ]);
      }
    } else {
      // 通常のメール入力フォーム
      await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
      await page.fill('input[type="email"], input[name="email"]', email);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }),
        page.keyboard.press("Enter"),
      ]);
      // account_selector に遷移した場合
      if (page.url().includes("account_selector")) {
        const accountBtn = page.locator(`button:has-text("${email}")`);
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }),
          accountBtn.click(),
        ]);
      }
    }

    // パスワード入力
    await page.waitForSelector('input[type="password"]', { timeout: 30000 });
    await page.fill('input[type="password"]', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      page.keyboard.press("Enter"),
    ]);

    // OTP が要求される場合は手動入力（URLではなくセレクターで判定）
    const otpSelector = 'input[name*="otp" i], input[name*="code" i], input[type="number"][maxlength]';
    const otpAppeared = await page.waitForSelector(otpSelector, { timeout: 8000 }).then(() => true).catch(() => false);
    if (otpAppeared) {
      console.log(`OTP入力画面: ${page.url()}`);
      const otp = await prompt("OTPを入力してください: ");
      await page.fill(otpSelector, otp);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.keyboard.press("Enter"),
      ]);
    }

    // ログイン完了（moneyforward.com への遷移）を待機
    await page.waitForURL(/^https:\/\/moneyforward\.com\//, { timeout: 60000 });
    console.log("ログイン完了");
    await sleep(2000);

    // ホームページ（カンタン入力）へ遷移
    await page.goto(MF_URL, { waitUntil: "domcontentloaded" });
    await sleep(2000);
  }

  // ログイン済みだが /cf にいる場合はホームへ移動
  if (!page.url().startsWith(MF_URL)) {
    await page.goto(MF_URL, { waitUntil: "domcontentloaded" });
    await sleep(2000);
  }

  console.log("登録を開始します...");

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < expenses.length; i++) {
    const row = expenses[i];
    const absAmount = Math.abs(row.amount);
    const category = getCategory(row.subject);

    console.log(`[${i + 1}/${expenses.length}] ${row.date} ${row.subject} ¥${absAmount}`);

    try {
      // 大カテゴリドロップダウンを開く（これでDOMにメニューが展開される）
      await page.locator("#js-large-category-selected").click();
      await page.locator("#cf-manual-entry .btn_l_ctg .dropdown-menu.main_menu").waitFor({ state: "visible" });

      // ドロップダウンが開いている間に large/middle category ID を取得して hidden input に直接セット
      await page.evaluate(
        (args: { large: string; small: string | null; middleId: string | null }) => {
          const { large, small, middleId } = args;
          const largeLi = Array.from(
            document.querySelectorAll(
              "#cf-manual-entry .btn_l_ctg .dropdown-menu.main_menu li.dropdown-submenu"
            )
          ).find(
            (li) =>
              (li.querySelector("a.l_c_name") as HTMLElement)?.textContent?.trim() === large
          );
          if (!largeLi) return;

          const largeCatId = (largeLi.querySelector("a.l_c_name") as HTMLElement).getAttribute("id");
          if (largeCatId) {
            (document.querySelector("#user_asset_act_large_category_id") as HTMLInputElement).value = largeCatId;
            // ボタン表示を更新
            const btn = document.querySelector("#js-large-category-selected") as HTMLElement;
            if (btn) btn.childNodes[0].textContent = large;
          }

          // 小カテゴリ
          if (small) {
            const smallA = Array.from(largeLi.querySelectorAll("a.m_c_name")).find(
              (a) => (a as HTMLElement).textContent?.trim() === small
            ) as HTMLElement | undefined;
            const middleCatId = smallA?.getAttribute("id");
            if (middleCatId) {
              (document.querySelector("#user_asset_act_middle_category_id") as HTMLInputElement).value = middleCatId;
              // ボタン表示を更新
              const mBtn = document.querySelector("#js-middle-category-selected") as HTMLElement;
              if (mBtn) mBtn.childNodes[0].textContent = small;
            }
          } else if (middleId) {
            // middleId 明示指定（food費 id:105 など）
            (document.querySelector("#user_asset_act_middle_category_id") as HTMLInputElement).value = middleId;
          }
        },
        { large: category.large, small: category.small, middleId: category.middleId }
      );

      // ドロップダウンを閉じる
      await page.keyboard.press("Escape");

      // 日付入力（hidden input + 表示ラベル を直接セット）
      await page.evaluate((date: string) => {
        (document.querySelector("#js-cf-manual-payment-entry-updated-at") as HTMLInputElement).value = date;
        const label = document.querySelector("#js-cf-manual-payment-entry-updated-at-label") as HTMLElement;
        if (label) label.textContent = date;
        const cal = document.querySelector("#js-cf-manual-payment-entry-calendar") as HTMLElement;
        if (cal) cal.setAttribute("data-date", date);
      }, row.date);

      // 金額入力
      await page.locator("#js-cf-manual-payment-entry-amount").fill(String(absAmount));

      // 支出元（Suica）選択（ラベルに空白が含まれるため evaluate で選択）
      await page.evaluate(() => {
        const sel = document.querySelector('#cf-manual-entry select[name="user_asset_act[sub_account_id_hash]"]') as HTMLSelectElement;
        const opt = Array.from(sel.options).find(o => o.text.includes("Suica"));
        if (opt) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });

      // 件名入力
      await page.locator("#js-cf-manual-payment-entry-content").fill(row.subject);

      // 送信
      await page.locator("#js-cf-manual-payment-entry-submit-button").click();

      // Ajax完了を待つ（金額フィールドがリセットされるまで）
      await page.waitForFunction(
        () => {
          const el = document.querySelector<HTMLInputElement>("#js-cf-manual-payment-entry-amount");
          return el != null && el.value === "";
        },
        { timeout: 10000 }
      );

      successCount++;
      console.log(`  ✓ 登録完了`);
    } catch (err) {
      failCount++;
      console.error(`  ✗ 登録失敗: ${err}`);
    }

    if (i < expenses.length - 1) {
      await sleep(INTERVAL_MS);
    }
  }

  console.log(`\n完了: 成功${successCount}件 / 失敗${failCount}件`);

  if (incomes.length > 0) {
    console.log(`\n--- 振替、手動登録が必要な履歴 (${incomes.length}件) ---`);
    for (const r of incomes) {
      console.log(`  ${r.date}\t${r.subject}\t+${r.amount.toLocaleString()}`);
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
