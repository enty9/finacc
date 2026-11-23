import {
  dateKey,
  parseMoney,
  validDate,
  type Category,
  type Kind,
  type Transaction,
} from "./domain.ts";

export interface FnsQrResult {
  amount: number;
  date: string;
  title: string;
  note: string;
}

export function parseFnsQr(raw: string): FnsQrResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const query = trimmed.includes("?") ? trimmed.split("?")[1] : trimmed;
  const params = new URLSearchParams(query);
  const t = params.get("t");
  const s = params.get("s");
  if (!t || !s) return null;

  const dateMatch = t.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!dateMatch) return null;
  const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  if (!validDate(date) || date > dateKey()) return null;

  let amount: number;
  try {
    amount = parseMoney(s, false);
  } catch {
    return null;
  }

  const time = `${dateMatch[4]}:${dateMatch[5]}`;
  const fn = params.get("fn");
  const fd = params.get("i");
  const fp = params.get("fp");
  const details = [
    fn ? `ФН ${fn}` : "",
    fd ? `ФД ${fd}` : "",
    fp ? `ФП ${fp}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return {
    amount,
    date,
    title: `Чек от ${dateMatch[3]}.${dateMatch[2]} (${time})`,
    note: details ? `Чек ФНС: ${details}` : "Чек ФНС",
  };
}

function splitCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function detectDelimiter(sample: string): string {
  const candidates = [";", ",", "\t"];
  let best = ";";
  let bestScore = -1;
  const lines = sample.split(/\r?\n/).slice(0, 5).join("\n");
  for (const delim of candidates) {
    let inQuotes = false;
    let count = 0;
    for (const ch of lines) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === delim) count++;
    }
    if (count > bestScore) {
      bestScore = count;
      best = delim;
    }
  }
  return best;
}

function parseFlexibleDate(raw: string): string | null {
  const text = raw.trim();
  const dmy = text.match(/^(\d{2})[./](\d{2})[./](\d{4})/);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    return validDate(iso) ? iso : null;
  }
  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const iso = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    return validDate(iso) ? iso : null;
  }
  return null;
}

function parseSignedAmount(raw: string): { sign: -1 | 1; amount: number } | null {
  const cleaned = raw
    .replace(/\u00A0/g, " ")
    .replace(/(₽|RUB|р\.?|руб\.?)/gi, "")
    .trim();
  if (!cleaned) return null;
  const negative = cleaned.startsWith("-") || cleaned.startsWith("−");
  const unsigned = cleaned.replace(/^[+\-−]+/, "").trim();
  if (!unsigned) return null;
  try {
    const amount = parseMoney(unsigned, false);
    return { sign: negative ? -1 : 1, amount };
  } catch {
    return null;
  }
}

export interface BankCsvParseResult {
  items: Omit<Transaction, "id">[];
  skipped: number;
}

export function parseBankCsv(
  rawText: string,
  categories: Category[],
  defaultAccountId: string,
): BankCsvParseResult {
  const text = rawText.replace(/^\uFEFF/, "").trim();
  if (!text) return { items: [], skipped: 0 };

  const delimiter = detectDelimiter(text);
  const rows = splitCsvRows(text, delimiter).filter((r) =>
    r.some((c) => c.trim().length > 0),
  );
  if (rows.length === 0) return { items: [], skipped: 0 };

  let headerIndex = -1;
  let colDate = -1;
  let colType = -1;
  let colCategory = -1;
  let colTitle = -1;
  let colAmount = -1;
  let colExpense = -1;
  let colIncome = -1;
  let colNote = -1;
  let colTags = -1;

  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const headers = rows[i].map((h) => h.trim().toLocaleLowerCase("ru"));
    const dIdx = headers.findIndex((h) => /дата|date/.test(h));
    const aIdx = headers.findIndex((h) =>
      /сумма\s*\(rub\)|сумма операции|сумма платежа|сумма|amount|sum/.test(h),
    );
    const eIdx = headers.findIndex((h) =>
      /расход|списание|expense|debit/.test(h),
    );
    const iIdx = headers.findIndex((h) =>
      /доход|пополнение|зачисление|income|credit/.test(h),
    );

    if (dIdx !== -1 && (aIdx !== -1 || eIdx !== -1 || iIdx !== -1)) {
      headerIndex = i;
      colDate = dIdx;
      colAmount = aIdx;
      colExpense = eIdx;
      colIncome = iIdx;
      colType = headers.findIndex((h) => /^(тип|type|операция)/.test(h));
      colCategory = headers.findIndex((h) => /категория|category/.test(h));
      colTitle = headers.findIndex((h) =>
        /описание|назначение|название|детали|получатель|title|description|merchant/.test(
          h,
        ),
      );
      colNote = headers.findIndex((h) =>
        /примечание|комментарий|заметка|note|comment/.test(h),
      );
      colTags = headers.findIndex((h) => /теги|tags/.test(h));
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error(
      "Не удалось распознать колонки CSV. Убедитесь, что есть столбцы «Дата» и «Сумма».",
    );
  }

  const today = dateKey();
  const items: Omit<Transaction, "id">[] = [];
  let skipped = 0;

  const fallbackExpense =
    categories.find((c) => c.kind === "expense" && c.id === "other")?.id ??
    categories.find((c) => c.kind === "expense")?.id ??
    "other";
  const fallbackIncome =
    categories.find((c) => c.kind === "income" && c.id === "gift")?.id ??
    categories.find((c) => c.kind === "income")?.id ??
    "gift";

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const dateRaw = row[colDate] ?? "";
    const date = parseFlexibleDate(dateRaw);
    if (!date || date > today) {
      if (dateRaw.trim()) skipped++;
      continue;
    }

    const typeRaw =
      colType !== -1 ? (row[colType] ?? "").trim().toLocaleLowerCase("ru") : "";
    if (
      /перевод|взнос|снятие накоп|погашение|увеличение долга|возврат долга/.test(
        typeRaw,
      )
    ) {
      skipped++;
      continue;
    }

    let kind: Kind | null = null;
    let amount = 0;

    if (colExpense !== -1 || colIncome !== -1) {
      const exp =
        colExpense !== -1 ? parseSignedAmount(row[colExpense] ?? "") : null;
      const inc =
        colIncome !== -1 ? parseSignedAmount(row[colIncome] ?? "") : null;
      if (exp && exp.amount > 0) {
        kind = "expense";
        amount = exp.amount;
      } else if (inc && inc.amount > 0) {
        kind = "income";
        amount = inc.amount;
      }
    }

    if (amount === 0 && colAmount !== -1) {
      const parsed = parseSignedAmount(row[colAmount] ?? "");
      if (parsed) {
        amount = parsed.amount;
        if (/доход|income|поступлен|зачислен/.test(typeRaw)) {
          kind = "income";
        } else if (/расход|expense|списан|оплата/.test(typeRaw)) {
          kind = "expense";
        } else {
          kind = parsed.sign < 0 ? "expense" : "income";
        }
      }
    }

    if (!kind || amount <= 0) {
      skipped++;
      continue;
    }

    const titleRaw =
      colTitle !== -1
        ? (row[colTitle] ?? "").trim()
        : colCategory !== -1
          ? (row[colCategory] ?? "").trim()
          : "";
    const title = (titleRaw || (kind === "income" ? "Поступление" : "Покупка")).slice(
      0,
      120,
    );

    const catRaw =
      colCategory !== -1
        ? (row[colCategory] ?? "").trim().toLocaleLowerCase("ru")
        : "";
    const matchedCategory = catRaw
      ? categories.find(
          (c) =>
            c.kind === kind &&
            (c.name.toLocaleLowerCase("ru") === catRaw ||
              c.name.toLocaleLowerCase("ru").includes(catRaw) ||
              catRaw.includes(c.name.toLocaleLowerCase("ru"))),
        )
      : undefined;

    const categoryId =
      matchedCategory?.id ??
      (kind === "expense" ? fallbackExpense : fallbackIncome);

    const note =
      colNote !== -1 ? (row[colNote] ?? "").trim().slice(0, 500) : "";

    const tagsRaw = colTags !== -1 ? (row[colTags] ?? "").trim() : "";
    const tags = tagsRaw
      ? [
          ...new Set(
            tagsRaw
              .split(/[,\s]+/)
              .map((tag) => tag.replace(/^#/, "").trim().slice(0, 40))
              .filter(Boolean),
          ),
        ].slice(0, 20)
      : undefined;

    items.push({
      kind,
      amount,
      title,
      categoryId,
      date,
      note,
      accountId: defaultAccountId,
      ...(tags && tags.length ? { tags } : {}),
    });
  }

  return { items, skipped };
}
