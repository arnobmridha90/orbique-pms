# Kozi websites

Static sites for the Kozi rental brand, built by `build.py` (Python 3 + Pillow).

- `out/staykozi-com/` is the global site (country picker) for www.staykozi.com
- `out/staykozi-my/` is the Malaysia site (cities, buildings, suites, guides) for www.staykozi.my

Each folder is its own Vercel project with no build step (Root Directory set to the folder).

To rebuild after changing `src/` or `build.py`:

    KOZI_PHOTOS=/path/to/unit/photos python3 websites/kozi/build.py

Commit the regenerated `out/` folders. Rules: no prices on the site (rate parity with booking sites), and no walking times until they have been measured.
