import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decryptBackup,
  encryptBackup,
  hashPin,
  isEncryptedBackup,
  verifyPin,
} from "../src/crypto.ts";
import { dateKey, emptyData } from "../src/domain.ts";

describe("PIN lock and encrypted backups", () => {
  it("hashes and verifies PIN codes", async () => {
    const record = await hashPin("2580");
    assert.equal(await verifyPin("2580", record), true);
    assert.equal(await verifyPin("0000", record), false);
    await assert.rejects(() => hashPin("12"));
    await assert.rejects(() => hashPin("abcd"));
  });

  it("encrypts and decrypts backup snapshots with AES-GCM", async () => {
    const data = emptyData();
    data.name = "Джамиль";
    data.transactions.push({
      id: "t1",
      kind: "expense",
      amount: 45000,
      title: "Кофе",
      categoryId: "cafe",
      date: dateKey(),
      note: "",
      accountId: "main",
    });

    const json = await encryptBackup(data, "secret-123");
    const parsed: unknown = JSON.parse(json);
    assert.equal(isEncryptedBackup(parsed), true);

    const restored = await decryptBackup(parsed, "secret-123");
    assert.equal(restored.name, "Джамиль");
    assert.equal(restored.transactions.length, 1);
    assert.equal(restored.transactions[0].amount, 45000);

    await assert.rejects(() => decryptBackup(parsed, "wrong-password"));
  });
});
