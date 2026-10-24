import { db } from "./db.js";

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function totals(householdId: number, month: string) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
              COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense,
              COUNT(*) AS count
       FROM transactions WHERE household_id = ? AND substr(date,1,7) = ?`,
    )
    .get(householdId, month) as { income: number; expense: number; count: number };
}

export function monthlyStats(householdId: number, month: string) {
  const cur = totals(householdId, month);
  const prev = totals(householdId, shiftMonth(month, -1));

  const byCategory = db
    .prepare(
      `SELECT c.id, COALESCE(c.name,'미분류') AS name, COALESCE(c.icon,'') AS icon, COALESCE(c.color,'#9ca3af') AS color,
              SUM(t.amount) AS amount, COUNT(*) AS count,
              (SELECT amount FROM budgets b WHERE b.household_id = t.household_id AND b.category_id = c.id) AS budget
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.household_id = ? AND t.type = 'expense' AND substr(t.date,1,7) = ?
       GROUP BY c.id ORDER BY amount DESC`,
    )
    .all(householdId, month) as { id: number | null; name: string; amount: number; budget: number | null }[];

  const prevByCategory = new Map(
    (
      db
        .prepare(
          `SELECT category_id AS id, SUM(amount) AS amount FROM transactions
           WHERE household_id = ? AND type = 'expense' AND substr(date,1,7) = ? GROUP BY category_id`,
        )
        .all(householdId, shiftMonth(month, -1)) as { id: number | null; amount: number }[]
    ).map((r) => [r.id, r.amount]),
  );

  const bySubcategory = db
    .prepare(
      `SELECT c.name AS category, t.subcategory, SUM(t.amount) AS amount
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.household_id = ? AND t.type = 'expense' AND substr(t.date,1,7) = ?
       GROUP BY t.category_id, t.subcategory ORDER BY amount DESC`,
    )
    .all(householdId, month);

  const byMember = db
    .prepare(
      `SELECT COALESCE(u.name,'공동') AS name,
              SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END) AS expense,
              SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) AS income
       FROM transactions t LEFT JOIN users u ON u.id = t.member_id
       WHERE t.household_id = ? AND substr(t.date,1,7) = ? GROUP BY t.member_id`,
    )
    .all(householdId, month);

  const daily = db
    .prepare(
      `SELECT date, SUM(amount) AS amount FROM transactions
       WHERE household_id = ? AND type = 'expense' AND substr(date,1,7) = ? GROUP BY date ORDER BY date`,
    )
    .all(householdId, month);

  const from = shiftMonth(month, -11);
  const trendRows = db
    .prepare(
      `SELECT substr(date,1,7) AS month,
              SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income,
              SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense
       FROM transactions WHERE household_id = ? AND substr(date,1,7) BETWEEN ? AND ? GROUP BY month`,
    )
    .all(householdId, from, month) as { month: string; income: number; expense: number }[];
  const trend = Array.from({ length: 12 }, (_, i) => {
    const m = shiftMonth(from, i);
    return trendRows.find((r) => r.month === m) ?? { month: m, income: 0, expense: 0 };
  });

  const topMerchants = db
    .prepare(
      `SELECT merchant, SUM(amount) AS amount, COUNT(*) AS count FROM transactions
       WHERE household_id = ? AND type = 'expense' AND substr(date,1,7) = ? AND merchant <> ''
       GROUP BY merchant ORDER BY amount DESC LIMIT 7`,
    )
    .all(householdId, month);

  // 직전 3개월 평균 대비 이번 달 카테고리 지출이 크게 늘었는지
  const avg3 = new Map(
    (
      db
        .prepare(
          `SELECT category_id AS id, SUM(amount) / 3.0 AS amount FROM transactions
           WHERE household_id = ? AND type = 'expense' AND substr(date,1,7) BETWEEN ? AND ? GROUP BY category_id`,
        )
        .all(householdId, shiftMonth(month, -3), shiftMonth(month, -1)) as { id: number | null; amount: number }[]
    ).map((r) => [r.id, r.amount]),
  );
  const insights: string[] = [];
  for (const c of byCategory) {
    const a = avg3.get(c.id) ?? 0;
    if (a > 0 && c.amount > a * 1.3 && c.amount - a > 50000) {
      insights.push(`${c.name} 지출이 최근 3개월 평균보다 ${Math.round((c.amount / a - 1) * 100)}% 많아요.`);
    }
    if (c.budget && c.amount > c.budget) {
      insights.push(`${c.name} 예산을 ${(c.amount - c.budget).toLocaleString("ko-KR")}원 초과했어요.`);
    }
  }

  return {
    month,
    income: cur.income,
    expense: cur.expense,
    net: cur.income - cur.expense,
    count: cur.count,
    savingsRate: cur.income ? Math.round(((cur.income - cur.expense) / cur.income) * 1000) / 10 : null,
    prev: { income: prev.income, expense: prev.expense },
    byCategory: byCategory.map((c) => ({ ...c, prevAmount: prevByCategory.get(c.id) ?? 0 })),
    bySubcategory,
    byMember,
    daily,
    trend,
    topMerchants,
    insights,
  };
}
