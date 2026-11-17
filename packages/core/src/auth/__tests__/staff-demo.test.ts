import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {Db} from "@namilux/db";
import {staffLogin} from "../staff";
import {hashToken} from "../sessions";

const spies = vi.hoisted(() => ({password:vi.fn(),event:vi.fn(),enqueue:vi.fn()}));
vi.mock("../password",async importOriginal => ({...await importOriginal<Record<string,unknown>>(),verifyPassword:spies.password}));
vi.mock("../../security",()=>({security:{event:spies.event}}));
vi.mock("../../jobs",()=>({jobs:{enqueue:spies.enqueue}}));
const user = {id:"demo-staff",email:"owner@example.test",name:"Owner",passwordHash:"hash",totpSecretEnc:"unchanged",totpEnabled:true,isActive:true,failedAttempts:0,lockedUntil:null,roleId:1};
const input = {email:user.email,password:"correct",ip:"127.0.0.1",ua:"unit-test"};
function fixture(row: Record<string,unknown> | null = user) {
  const limit=vi.fn().mockResolvedValueOnce(row ? [row] : []).mockResolvedValue([]);
  const chain={from:vi.fn(),where:vi.fn(),orderBy:vi.fn(),limit};
  chain.from.mockReturnValue(chain); chain.where.mockReturnValue(chain); chain.orderBy.mockReturnValue(chain);
  const values=vi.fn().mockResolvedValue(undefined);
  const updates=vi.fn().mockReturnValue({where:vi.fn().mockResolvedValue(undefined)});
  const db={select:vi.fn(()=>chain),insert:vi.fn(()=>({values})),update:vi.fn(()=>({set:updates}))};
  return {db:db as unknown as Db,values,updates};
}
beforeEach(()=>{
  vi.clearAllMocks(); spies.password.mockResolvedValue(true);
  vi.stubEnv("SESSION_PEPPER","a".repeat(64));
  vi.stubEnv("ADMIN_TOTP_DISABLED","1"); vi.stubEnv("APP_ENV","dev");
  vi.stubEnv("ADMIN_ORIGIN","https://203.0.113.10:8100");
});
afterEach(()=>vi.unstubAllEnvs());
describe("password-only demo login",()=>{
  it("creates an ordinary hashed session only after a valid password",async()=>{
    const f=fixture(); const result=await staffLogin(f.db,input);
    expect(spies.password).toHaveBeenCalledWith("hash","correct");
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.tempToken).toBe(""); expect(result.needsTotp).toBe(false);
    expect(f.values).toHaveBeenCalledWith(expect.objectContaining({staffId:user.id,tokenHash:hashToken(result.token??"","a".repeat(64)),ip:input.ip,ua:input.ua}));
    expect(f.updates).not.toHaveBeenCalledWith(expect.objectContaining({totpEnabled:false}));
    expect(spies.enqueue).toHaveBeenCalled();
  });
  it("rejects incorrect passwords without a session",async()=>{
    spies.password.mockResolvedValue(false); const f=fixture();
    await expect(staffLogin(f.db,input)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(f.values).not.toHaveBeenCalled(); expect(spies.event).toHaveBeenCalled();
  });
  it.each([{...user,isActive:false},{...user,lockedUntil:new Date('2099-01-01')}])("rejects inactive or locked users",async row=>{
    const f=fixture(row); await expect(staffLogin(f.db,input)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(f.values).not.toHaveBeenCalled();
  });
  it("rejects missing users",async()=>{
    const f=fixture(null);
    await expect(staffLogin(f.db,input)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(f.values).not.toHaveBeenCalled();
  });
  it.each(["prod",""])("retains TOTP when APP_ENV is %s",async mode=>{
    vi.stubEnv("APP_ENV",mode); const f=fixture(); const result=await staffLogin(f.db,input);
    expect(result.needsTotp).toBe(true); expect(result.tempToken).not.toBe(""); expect(result.token).toBeUndefined();
    expect(f.values).not.toHaveBeenCalled();
  });
  it("retains TOTP when the exception flag is off",async()=>{
    vi.stubEnv("ADMIN_TOTP_DISABLED","0"); const f=fixture();
    expect((await staffLogin(f.db,input)).token).toBeUndefined(); expect(f.values).not.toHaveBeenCalled();
  });
});
