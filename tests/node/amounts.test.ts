import assert from "node:assert/strict";
import { test } from "node:test";
import { decimalUnits, exactDecimal, attoInput, integerInput } from "../../lib/amounts";
import { deploymentId } from "../../lib/deployment";

test("every monetary form parses exact sub-token decimal amounts", () => {
  for (const value of ["0.29","0.5","3.75","0.009","1.000000000000000001"]) {
    assert.equal(exactDecimal(decimalUnits(value).toString()),value);
  }
  assert.equal(decimalUnits("0.29"),290000000000000000n);
  for(const bad of ["", "0", "1e3", "-1", "NaN", "1.0000000000000000001"]) assert.throws(()=>decimalUnits(bad));
  assert.throws(()=>attoInput("-1"));assert.throws(()=>attoInput((1n<<256n).toString()));
  assert.throws(()=>integerInput("1foo","index"));
});
test("deployment identities isolate all economic cache records",()=>{
  const base={GENLAYER_NETWORK:"studionet",NEXT_PUBLIC_FACILITY_REGISTRY_ADDRESS:"0xaaa",NEXT_PUBLIC_COVENANT_MONITOR_ADDRESS:"0xbbb",NEXT_PUBLIC_CREDIT_VAULT_ADDRESS:"0xccc"};
  assert.notEqual(deploymentId(base),deploymentId({...base,NEXT_PUBLIC_FACILITY_REGISTRY_ADDRESS:"0xddd"}));
  assert.notEqual(deploymentId(base),deploymentId({...base,GENLAYER_NETWORK:"testnet_bradbury"}));
  assert.equal(deploymentId(base),deploymentId({...base,NEXT_PUBLIC_CREDIT_VAULT_ADDRESS:"0xCCC"}));
});

test("every facility read model uses a physical deployment schema", async()=>{
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const model = await import("../../lib/db/schema");
  const { schemaStatements } = await import("../../lib/db/bootstrap");
  for(const table of [model.facilities,model.positions,model.covenants,model.covenantTests,model.alerts,model.sweeps]) {
    assert.match(getTableConfig(table).schema ?? "",/^covenant_[a-f0-9]{24}$/);
  }
  assert.equal(getTableConfig(model.users).schema,undefined);
  const sql = schemaStatements().join("\n");
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/terms_digest/);
  assert.match(sql,/CREATE SCHEMA IF NOT EXISTS/);
  assert.throws(()=>schemaStatements('public; drop table users'));
});
