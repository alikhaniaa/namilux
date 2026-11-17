import { describe, expect, it } from "vitest";
import { s3Storage, sigv4 } from "../s3";

// The AWS "GET Object" SigV4 example (Amazon S3 API Reference, Authenticating Requests: Using
// Query Parameters / Examples): example keys, 2013-05-24, examplebucket, /test.txt, Range: bytes=0-9.
const AWS_EXAMPLE = {
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  now: new Date("2013-05-24T00:00:00Z"),
};

describe("s3 storage", () => {
  it("sigv4 matches known vector", () => {
    const headers = sigv4(
      { method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { Range: "bytes=0-9" }, body: "" },
      AWS_EXAMPLE,
    );
    expect(headers["x-amz-date"]).toBe("20130524T000000Z");
    expect(headers["x-amz-content-sha256"]).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("publicUrl uses publicBase", () => {
    const s = s3Storage({ endpoint: "https://s3.ir-thr-at1.arvanstorage.ir/", bucket: "namilux-media", accessKey: "a", secretKey: "b", publicBase: "https://media.namilux.ir/" });
    expect(s.publicUrl("p/1044/1/abc.jpg")).toBe("https://media.namilux.ir/p/1044/1/abc.jpg");
    expect(() => s.publicUrl("../etc/passwd")).toThrow(/unsafe storage key/);
    expect(s.key).toBe("s3");
  });
});
