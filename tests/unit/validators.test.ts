import { describe, expect, it } from 'vitest';
import { checkAadhaar, checkAccount, checkEsi, checkIfsc, checkMobile, checkName, checkPan, checkPf, checkUpi, cleanAadhaar, cleanPan, cleanUpi, joiningDateProblem, verhoeffDigit, verhoeffValid } from '@/lib/validators';

describe('Aadhaar', () => {
  it('knows the Verhoeff checksum (published example 2363)', () => {
    expect(verhoeffValid('2363')).toBe(true);
    expect(verhoeffDigit('236')).toBe(3);
    expect(verhoeffValid('2364')).toBe(false);
  });
  it('accepts a valid number typed with spaces or dashes', () => {
    expect(checkAadhaar('2341 2341 2346')).toBe('');
    expect(checkAadhaar('2341-2341-2346')).toBe('');
    expect(cleanAadhaar('2341 2341 2346')).toBe('234123412346');
    expect(checkAadhaar('')).toBe('');
  });
  it('refuses wrong length, a leading 0 or 1, letters and a bad check digit', () => {
    expect(checkAadhaar('23412341234')).toMatch(/exactly 12/);
    expect(checkAadhaar('1234 1234 1234')).toMatch(/cannot start/);
    expect(checkAadhaar('0234 1234 1234')).toMatch(/cannot start/);
    expect(checkAadhaar('2341234123AB')).toMatch(/digits only/);
    expect(checkAadhaar('234123412347')).toMatch(/not valid/);
  });
});

describe('PAN', () => {
  it('accepts the format, any case, and normalises to capitals', () => {
    expect(checkPan('abcpe1234f')).toBe('');
    expect(cleanPan(' abcpe1234f ')).toBe('ABCPE1234F');
  });
  it('refuses wrong shapes and an impossible 4th letter', () => {
    expect(checkPan('ABCPE1234')).toMatch(/must look like/);
    expect(checkPan('1BCPE1234F')).toMatch(/must look like/);
    expect(checkPan('ABCDE1234F')).toMatch(/4th letter/);
  });
});

describe('bank account, IFSC and UPI', () => {
  it('account: 9 to 18 digits, not one repeated digit', () => {
    expect(checkAccount('123456789012')).toBe('');
    expect(checkAccount('1234 5678 9012')).toBe('');
    expect(checkAccount('12345678')).toMatch(/9 to 18/);
    expect(checkAccount('1234567890123456789')).toMatch(/9 to 18/);
    expect(checkAccount('000000000000')).toMatch(/not valid/);
    expect(checkAccount('12345678AB90')).toMatch(/digits only/);
  });
  it('IFSC: four letters, a zero, six letters or digits', () => {
    expect(checkIfsc('sbin0001234')).toBe('');
    expect(checkIfsc('SBIN1001234')).toMatch(/must look like/);
    expect(checkIfsc('SBI0001234')).toMatch(/must look like/);
  });
  it('UPI: name@bank, kept in small letters', () => {
    expect(checkUpi('9829012345@ybl')).toBe('');
    expect(checkUpi('Ramesh.Meena-1@OkHdfcBank')).toBe('');
    expect(cleanUpi(' Ramesh@OKSBI ')).toBe('ramesh@oksbi');
    expect(checkUpi('ramesh')).toMatch(/name@bank/);
    expect(checkUpi('@ybl')).toMatch(/name@bank/);
    expect(checkUpi('a@b')).toMatch(/name@bank/);
  });
});

describe('PF, ESI, mobile, name, dates', () => {
  it('PF: a 12-digit UAN or an account number with letters, digits, / and -', () => {
    expect(checkPf('123456789012')).toBe('');
    expect(checkPf('RJ/BHL/0012345/000/0001234')).toBe('');
    expect(checkPf('12345')).toMatch(/12 digits/);
    expect(checkPf('AB CD!')).toMatch(/PF number can have/);
  });
  it('ESI: exactly 10 digits', () => {
    expect(checkEsi('1234567890')).toBe('');
    expect(checkEsi('123456789')).toMatch(/10 digits/);
  });
  it('mobile: 10 digits from 6-9, +91 and 0 are dropped, no repeated digit', () => {
    expect(checkMobile('+91 98290 12345')).toBe('');
    expect(checkMobile('09829012345')).toBe('');
    expect(checkMobile('1234567890')).toMatch(/starting with 6/);
    expect(checkMobile('9999999999')).toMatch(/not valid/);
    expect(checkMobile('98290')).toMatch(/10-digit/);
  });
  it('name: starts with a letter (Hindi too), no symbols', () => {
    expect(checkName('Ramesh Meena')).toBe('');
    expect(checkName('रमेश मीणा')).toBe('');
    expect(checkName("D'Souza-Rao Jr.")).toBe('');
    expect(checkName('Raju 2')).toBe('');
    expect(checkName('R')).toMatch(/too short/);
    expect(checkName('9Ramesh')).toMatch(/start with a letter/);
    expect(checkName('Ramesh@#')).toMatch(/start with a letter/);
  });
  it('joining date: not before 1980, not more than 60 days ahead, leaving not before joining', () => {
    expect(joiningDateProblem('2024-04-01', '', '2026-10-16')).toBe('');
    expect(joiningDateProblem('1979-12-31', '', '2026-10-16')).toMatch(/too old/);
    expect(joiningDateProblem('2026-12-15', '', '2026-10-16')).toBe('');
    expect(joiningDateProblem('2026-12-16', '', '2026-10-16')).toMatch(/60 days/);
    expect(joiningDateProblem('2026-05-01', '2026-04-30', '2026-10-16')).toMatch(/Leaving date/);
  });
});
