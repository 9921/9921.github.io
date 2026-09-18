# Slideshow — publishing to GitHub Pages

1. Edit your words in `index.html` (look for the ✏️ EDIT comments — the three messages are in the note section).
2. Open `index.html` in a browser to preview it locally.
3. In Terminal, from this folder:

       git init
       git add .
       git commit -m "Slideshow"
       git branch -M main
       git remote add origin https://github.com/<you>/<repo>.git
       git push -u origin main

4. On GitHub: Settings → Pages → Source "Deploy from a branch" → main / root.
   The site appears at https://<you>.github.io/<repo>/ after a minute or two.

Only photos and videos with a person in them are used. The rest are listed in `excluded.txt`;
delete a line there to bring a file back (or add one to hide it), then run `python3 build_manifest.py` and push again.
