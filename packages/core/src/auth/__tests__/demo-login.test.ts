import {describe, it, expect} from "vitest";
import {passwordOnlyDemoEnabled} from "../demo-login";
const allowed = {ADMIN_TOTP_DISABLED:"1", APP_ENV:"dev", ADMIN_ORIGIN:"https://203.0.113.10:8100"};
describe("test-server password-only gate", () => {
  it("allows only the authorized dev/staging server", () => {
    expect(passwordOnlyDemoEnabled(allowed)).toBe(true);
    expect(passwordOnlyDemoEnabled({...allowed, APP_ENV:"staging"})).toBe(true);
  });
  it.each([undefined,"0","true",""])('rejects flag %s', ADMIN_TOTP_DISABLED => {
    expect(passwordOnlyDemoEnabled({...allowed, ADMIN_TOTP_DISABLED})).toBe(false);
  });
  it.each([undefined,"prod","production",""])('rejects environment %s', APP_ENV => {
    expect(passwordOnlyDemoEnabled({...allowed, APP_ENV})).toBe(false);
  });
  it.each([undefined,"https://admin.namilux.ir","https://203.0.113.10:8100.evil.test","http://203.0.113.10:8100"])('rejects origin %s', ADMIN_ORIGIN => {
    expect(passwordOnlyDemoEnabled({...allowed, ADMIN_ORIGIN})).toBe(false);
  });
});
