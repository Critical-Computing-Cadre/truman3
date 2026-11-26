# Where the sample videos come from

Every video here is cut from NASA footage, which is in the public domain. NASA's guidelines ask
that it be credited, and that it not be used to suggest NASA endorses anything. Each post's
description names the source. The channels that post them are made up, and aren't NASA.

What was changed in each: a stretch of about 35 seconds was cut out at 640×360, and its original
sound was replaced with a soft chord. NASA's videos sometimes use licensed music, so none of their
sound is kept. `scripts/starter-videos-cut.swift` makes them, with the size `640x360` and `fit`,
and the line under each says which stretch.

| File                 | From                                                                                                                                                          | Credit                                                 | Cut     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------- |
| `solar-flare.mp4`    | [NASA's SDO Captures Stunning 4K View of April 17 Solar Flare](https://images.nasa.gov/details/GSFC_20160426_SDO_m12224_SolarFlare_4K)                        | NASA's Goddard Space Flight Center/SDO                 | 8–43 s  |
| `mars-landing.mp4`   | [Perseverance Arrives at Mars: Feb. 18, 2021](https://images.nasa.gov/details/JPL-20201221-M2020f-0001-Perseverance%20Arrives%20at%20Mars%20-%20UHD%20Master) | NASA/JPL-Caltech                                       | 8–43 s  |
| `artemis-launch.mp4` | [Artemis I Launch Collage](https://images.nasa.gov/details/A1Launch)                                                                                          | NASA                                                   | 2–37 s  |
| `el-nino.mp4`        | [A 3D Look at the 2015 El Niño](https://images.nasa.gov/details/GSFC_20170526_ElNino_m12601_3D)                                                               | NASA's Goddard Space Flight Center                     | 8–43 s  |
| `red-spot.mp4`       | [Jupiter's Great Red Spot Shrinks and Grows](https://images.nasa.gov/details/GSFC_20180313_Jupiter_m12878_GreatRedSpot)                                       | NASA's Goddard Space Flight Center                     | 5–40 s  |
| `space-station.mp4`  | [Earth Views from the International Space Station](https://images.nasa.gov/details/Earth%20Views%20from%20the%20International%20Space%20Station)              | NASA                                                   | 15–50 s |
| `eclipse.mp4`        | [An EPIC View of the 2017 Total Solar Eclipse](https://images.nasa.gov/details/GSFC_20170822_Total_m12690_Eclipse)                                            | NASA's Goddard Space Flight Center, from NOAA's DSCOVR | 0–26 s  |

Each `.jpg` beside a video is its poster, a frame six seconds in.

The two pre-roll ads, `ad-coffee.mp4` and `ad-phone.mp4`, aren't NASA's. They're drawn by
`scripts/starter-ads.swift`, for made-up advertisers, and the script's comment says how each was made.
Their posters are frames four seconds in. `ad-coffee.vtt` is the coffee ad's captions, written by hand.

The faces in `media/actors` are the same ones the Photo sample uses.
