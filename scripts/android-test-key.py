#!/usr/bin/env python3
"""Make the Android test-build signing key from a secret phrase, the same key every time.

    ANDROID_TEST_KEY_SEED='any long phrase' python3 scripts/android-test-key.py ~/.android/debug.keystore

Used by .github/workflows/mobile.yml so every published test APK has the same signature and installs over the
previous one, without keeping a key file anywhere: the GitHub secret ANDROID_TEST_KEY_SEED is the only thing to guard.
Pull requests from forks never receive secrets, so they cannot produce this key.

The phrase is stretched with scrypt into a P-256 private key; the certificate has fixed names, serial and dates and an
RFC 6979 (deterministic) ECDSA signature, so the certificate, and with it the APK signature Android compares, is
byte-for-byte the same on every run. Written as a PKCS#12 keystore in the shape Android's build tools expect for a
debug key: alias androiddebugkey, store and key password "android".
Needs the Python package cryptography 44 or newer (deterministic ECDSA). Prints the certificate's SHA-256 fingerprint.
Changing the phrase changes the key: testers then uninstall the old test app once.
"""
import datetime, hashlib, os, sys
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

SALT = b'orbique-android-test-key-v1'
P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551


def main():
    if len(sys.argv) != 2:
        sys.exit('usage: ANDROID_TEST_KEY_SEED=... python3 scripts/android-test-key.py <keystore path>')
    seed = os.environ.get('ANDROID_TEST_KEY_SEED', '').strip()
    if len(seed) < 16:
        sys.exit('ANDROID_TEST_KEY_SEED must be at least 16 characters (a long phrase only you know).')
    material = hashlib.scrypt(seed.encode('utf-8'), salt=SALT, n=2 ** 15, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=48)
    scalar = int.from_bytes(material, 'big') % (P256_ORDER - 1) + 1
    key = ec.derive_private_key(scalar, ec.SECP256R1())

    name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, 'Orbique test build'),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Orbique'),
        x509.NameAttribute(NameOID.COUNTRY_NAME, 'MY'),
    ])
    cert = (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(key.public_key())
            .serial_number(1)
            .not_valid_before(datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc))
            .not_valid_after(datetime.datetime(2056, 1, 1, tzinfo=datetime.timezone.utc))
            .sign(key, hashes.SHA256(), ecdsa_deterministic=True))

    store = pkcs12.serialize_key_and_certificates(
        b'androiddebugkey', key, cert, None,
        serialization.PrivateFormat.PKCS12.encryption_builder()
        .kdf_rounds(50000)
        .key_cert_algorithm(pkcs12.PBES.PBESv2SHA256AndAES256CBC)
        .hmac_hash(hashes.SHA256())
        .build(b'android'))
    out = os.path.expanduser(sys.argv[1])
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(store)
    print('Android test key written to %s (certificate SHA-256 %s)' % (out, cert.fingerprint(hashes.SHA256()).hex()))


if __name__ == '__main__':
    main()
