# WorldGuessr Street View Hint

A Chrome extension that shows the country, compass area, and city for the current [WorldGuessr](https://www.worldguessr.com/) round.

WorldGuessr puts the round coordinates in the Street View embed URL. This extension reads that `location` parameter, asks [OpenStreetMap Nominatim](https://nominatim.org/) which country and city contain the point, and gives a compass direction (`southwest`, `northeast`, `central`, and the other six). A large city is measured from that city’s center. A small town is measured from the country’s center, so the direction matches the guess map. It does not use an API key, and the overlay does not print the coordinates.

`na` means the round has not loaded a location yet. If OpenStreetMap has a country but no city, `city` is `na` and `area` is the compass sector of the country.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Choose this folder.

## Use

Click the extension icon and turn **Hints** on. The switch is off until you enable it. While it is on, a round shows:

- country
- area
- city

A line of `…` means the lookup is still running. Turning hints off removes the overlay and stops new lookups.

While hints are on, the extension drops your guess pin on the corner map at that round’s location and centers the map on it. It does not press Guess. You can still move the pin before you lock the round in.

Place names and borders are © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licensed under ODbL. Lookups are cached on this computer and sent one at a time, under Nominatim’s one-request-per-second limit.
