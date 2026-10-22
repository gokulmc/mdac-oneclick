// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { detectPage } from '../../src/page/detect';

function load(html: string): Document {
  document.documentElement.innerHTML = html;
  return document;
}

// jsdom does not implement innerText, so detect.ts falls back to textContent.
const REGISTER = `<body><form name="permohonan" method="post" action="/mdac/register">
  <input id="passNo"><input id="arrDt"><input type="submit" id="submit"></form></body>`;

beforeEach(() => {
  document.documentElement.innerHTML = '<body></body>';
});

describe('detectPage', () => {
  it('recognises the register form', () => {
    expect(detectPage(load(REGISTER))).toBe('register-form');
  });
  it('a form named permohonan without the key fields is not the register form', () => {
    expect(detectPage(load('<body><form name="permohonan"></form></body>'))).toBe('other');
  });
  it.each([
    'Registration successful. Your MDAC has been emailed.',
    'Your registration was successful',
    'Registration is success',
    'Successfully registered',
    'Pendaftaran berjaya. Terima kasih.',
    'Anda telah berjaya didaftarkan',
    'Thank you for registering',
    'Your PIN is 1234',
  ])('recognises a confirmation: %s', (text) => {
    expect(detectPage(load(`<body><h2>${text}</h2></body>`))).toBe('confirmation');
  });
  it('the confirmation text next to a register form is still the register form', () => {
    expect(detectPage(load(REGISTER.replace('<input id="passNo">', '<p>Registration successful</p><input id="passNo">')))).toBe('register-form');
  });
  it('a confirmation message while a permohonan form is still present is not a confirmation', () => {
    expect(detectPage(load('<body><form name="permohonan"></form><p>Registration successful</p></body>'))).toBe('other');
  });
  it('any other page is other', () => {
    expect(detectPage(load('<body><h1>Welcome to the portal</h1></body>'))).toBe('other');
    expect(detectPage(load('<body></body>'))).toBe('other');
  });
});
