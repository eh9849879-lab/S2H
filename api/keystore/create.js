import crypto from 'crypto';
import forge from 'node-forge';
import { handlePreflight, json, error } from '../../lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return error(res, 405, 'Method not allowed');

  const body = req.body || {};
  const alias = String(body.alias || 'debugbuilder').replace(/[^\w.-]/g, '').slice(0, 64);
  const password = String(body.password || '').slice(0, 128);
  const commonName = String(body.commonName || 'Debug Builder App').slice(0, 64);

  if (password.length < 6) return error(res, 400, 'Password must be at least 6 characters');

  try {
    const { privateKey: privPem, publicKey: pubPem } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const forgePriv = forge.pki.privateKeyFromPem(privPem);
    const forgePub = forge.pki.publicKeyFromPem(pubPem);
    const cert = forge.pki.createCertificate();
    
    cert.publicKey = forgePub;
    cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 30);

    const attrs = [{ name: 'commonName', value: commonName }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(forgePriv, forge.md.sha256.create());

    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(forgePriv, [cert], password, { algorithm: '3des', friendlyName: alias });
    const p12Base64 = forge.util.encode64(forge.asn1.toDer(p12Asn1).getBytes());

    json(res, 200, { keystoreBase64: p12Base64, keystoreName: `${alias}.p12`, alias, password, warning: 'SAVE THIS NOW.' });
  } catch (e) {
    error(res, 500, 'Keystore generation failed: ' + e.message);
  }
    }
