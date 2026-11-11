# C4 level 1: system context

Horizon is a personal viewer for DJ sets: a fan picks a set, watches it (local video or YouTube) and follows its tracklist, with an artist theme, a bio and a live audio spectrum.

```mermaid
C4Context
  title Horizon - system context
  Person(fan, "Fan", "Follows a DJ set with its tracklist")
  System(horizon, "Horizon", "Viewer for DJ sets with tracklist, artist themes, bios and spectrum")
  System_Ext(youtube, "YouTube", "Hosts the sets that are not stored locally")
  System_Ext(cdn, "jsDelivr and Google Fonts", "Serve the Plyr player and the web fonts")
  Rel(fan, horizon, "Picks a set and follows its tracklist in")
  Rel(horizon, youtube, "Embeds set videos from")
  Rel(horizon, cdn, "Loads player and fonts from")
```
