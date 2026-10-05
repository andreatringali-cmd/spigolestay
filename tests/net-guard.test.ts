import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp, isPublicHost } from "../src/lib/net-guard.ts";

test("IPv4 privati e interni sono bloccati", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
});

test("IPv4 pubblici passano", () => {
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "172.15.0.1", "100.63.0.1", "1.1.1.1"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("IPv6: loopback, unique-local, link-local e IPv4-mapped sono bloccati", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  assert.equal(isPrivateIp("2606:4700:4700::1111"), false);
  assert.equal(isPrivateIp("::ffff:8.8.8.8"), false);
});

test("host: localhost, .internal, IP privati rifiutati senza DNS", async () => {
  for (const h of ["localhost", "foo.internal", "bar.local", "127.0.0.1", "[::1]", "169.254.169.254", "10.0.0.5", ""]) {
    assert.equal(await isPublicHost(h), false, h);
  }
  assert.equal(await isPublicHost("8.8.8.8"), true);
});
