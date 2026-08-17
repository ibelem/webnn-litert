import {describe, expect, it} from 'vitest';

import {isValidVersion} from './loader';

describe('isValidVersion', () => {
  it('accepts plain semver', () => {
    expect(isValidVersion('2.5.3')).toBe(true);
    expect(isValidVersion('0.0.1')).toBe(true);
    expect(isValidVersion('10.20.30')).toBe(true);
  });

  it('accepts a prerelease suffix', () => {
    expect(isValidVersion('2.6.0-rc.1')).toBe(true);
    expect(isValidVersion('1.0.0-beta')).toBe(true);
  });

  it('rejects a path-traversal payload', () => {
    // The version string is interpolated into a module URL. Without this
    // gate, this exact input would walk out of the @litertjs/core package
    // and import() would execute whatever it resolves to.
    expect(isValidVersion('1.0.0/../../@attacker/pkg')).toBe(false);
  });

  it('rejects a bare protocol-relative or absolute URL', () => {
    expect(isValidVersion('//evil.example/x')).toBe(false);
    expect(isValidVersion('https://evil.example')).toBe(false);
  });

  it('rejects missing or partial version segments', () => {
    expect(isValidVersion('2.5')).toBe(false);
    expect(isValidVersion('2')).toBe(false);
    expect(isValidVersion('')).toBe(false);
  });

  it('rejects trailing garbage after a valid-looking prefix', () => {
    expect(isValidVersion('2.5.3; rm -rf')).toBe(false);
    expect(isValidVersion('2.5.3 ')).toBe(false);
  });
});
