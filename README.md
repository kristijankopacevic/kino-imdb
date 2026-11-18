# kino-imdb

IMDb ocjene za Kino na Samsung TV-u: GitHub Actions ih svaki dan složi (`build.mjs`, isti kod kao Kino) i **šifrira** (`imdb-crypt.js`, tajna `IMDB_KEY`) na granu `data`. Bez ključa se ne mogu pročitati. Izvor: IMDb skupovi podataka, osobna nekomercijalna upotreba. Kod se održava u repozitoriju Kina (`scripts/imdb-repo/`).
