---

title: About
description: Who made Truman, where it came from, the papers that used it, and how to cite it.
---

# About

Truman was created by Dominic DiFranzo. It's named after _The Truman Show_.

## History

**It started at Cornell.** Dominic built Truman as a postdoc in Natalie Bazarova's Social Media Lab. The question was one real platforms wouldn't let researchers test: would people step in to stop cyberbullying if a site's design made them feel responsible?

The first study ran on EatSnap.Love, a made-up "Instagram for food." For three days, participants posted, liked, and commented alongside a cast of scripted users. They didn't know every other account was part of the experiment. It was published at CHI in 2018.

**It became a platform other researchers could use.** After that first study, Truman was released as open source under the MIT license and made general, so any study could define its own posts, actors, and conditions. Since then it has been used to study:

- bystander intervention and moderation
- AI moderators
- how norms of self-disclosure spread
- misinformation in communities
- safety nudges for teens
- how audiences respond to people who object to harassment

Labs at Cornell, Lehigh, VU Amsterdam, and UCL have run it, and so has the STIR Lab. Social Media TestDrive, a digital citizenship program for young people, was built from its code.

**Truman 3 is a full rebuild.** Every earlier study was its own copy of the code, so an improvement made for one study never reached the others. Truman 3, built at Lehigh in 2026, makes a study a set of settings. Researchers build studies in the browser, choose what kind of site participants see, and can fill it with AI-driven characters that stay on the study's script. Labs can use it hosted, or run it on their own servers.

## Versions

| Version    | What it was                                                                    |
| ---------- | ------------------------------------------------------------------------------ |
| Truman 1   | The original, at `cornellsml/truman`. Each study was a fork                    |
| Truman 2   | Cornell's cleanup, at `cornellsml/truman_2023`, maintained by Winice Hui       |
| Extensions | Truman Agents, Truman_SocialSim, VidShare, and others, built on Truman 1 and 2 |
| Truman 3   | The rebuild this site is about, at `Critical-Computing-Cadre/truman3`          |

Truman 3's AI actors build on ideas from Truman Agents, by Qian Yang and the Cornell DesignAI Group.

## How to cite Truman

If you use Truman in your research, please cite:

> DiFranzo, D., & Bazarova, N. N. (2018). The Truman Platform: Social media simulation for experimental research. Workshop paper, "Bridging the Lab and the Field," ICWSM 2018, Stanford, CA.

Also say which version of the software your study ran on. It matters for replication.

## Papers that used Truman

Newest first. No study on Truman 3 has been published yet. Everything here ran on an earlier version or on something built from one.

- Gallagher, A., Shi, H., & DiFranzo, D. (2026). Designing for safety in sensitive online spaces: The role of pseudonymity and verification friction. _Proceedings of the 18th ACM Web Science Conference_, 381–391.
- Zhao, P., Bazarova, N., Bae, I., Hui, W., Kizilcec, R. F., & Margolin, D. (2025). Restorative justice appeals trump retributive vigilance on social media. _PNAS Nexus_, pgaf255. (VidShare)
- Bae, I., Bazarova, N., Zhao, P., Kizilcec, R., Hui, W., & Margolin, D. (2025). Interplay of harassment and objection to harassment. Presented at the 111th National Communication Association Convention. (VidShare)
- Agha, Z., Martinez, M., Ali, N. S., DiFranzo, D., & Wisniewski, P. J. (2025). [SocialSim: An open source platform for conducting behavioral intervention research on social media](https://dl.acm.org/doi/full/10.1145/3715070.3757229). _Companion Publication of CSCW 2025_, 528–531. (Truman_SocialSim)
- Lazard, A. J., DiFranzo, D., Nicolla, S., Aghajari, Z., Pulido, M., Mao, C., Vereen, R. N., & Dasgupta, N. (2025). Sharing anti-vaping social media messages. _Journal of Adolescent Health_, 77(2), 253–261.
- Nicolla, S., McKenzie, A. H., Lazard, A. J., DiFranzo, D., Aghajari, Z., Mao, C., & Dasgupta, N. (2025). Young people are willing to intervene against rape myths online: A simulated social media experiment. _Journal of Adolescent Health_, 76(5), 839–846.
- Zhao, P., Bazarova, N. N., DiFranzo, D., Hui, W., Kizilcec, R. F., & Margolin, D. (2024). [Standing up to problematic content on social media: Which objection strategies draw the audience's approval?](https://doi.org/10.1093/jcmc/zmad046) _Journal of Computer-Mediated Communication_, 29(1). (VidShare)
- Agha, Z., Park, J., Wan, R., Ali, N. S., Wang, Y., DiFranzo, D., Badillo-Urquiola, K., & Wisniewski, P. J. (2024). [Tricky vs. transparent: Towards an ecologically valid and safe approach for evaluating online safety nudges for teens](https://dl.acm.org/doi/full/10.1145/3613904.3642313). _CHI '24_.
- Aghajari, Z., Baumer, E. P. S., Lazard, A., Dasgupta, N., Wang, Y., & DiFranzo, D. (2024). Investigating the mechanisms by which prevalent online community behaviors influence responses to misinformation: Do perceived norms really act as a mediator? _CHI '24_. The [Vaccine frames](/studies/vaccine-frames) example is a rebuild of this design.
- Aghajari, Z., Baumer, E. P. S., & DiFranzo, D. (2023). What's the norm around here? Individuals' responses can mitigate the effects of misinformation prevalence in shaping perceptions of a community. _CHI '23_.
- Ozanne, M., Bhandari, A., Bazarova, N. N., & DiFranzo, D. (2022). [Shall AI moderators be made visible? Perception of accountability and trust in moderation systems on social media platforms](https://doi.org/10.1177/20539517221115666). _Big Data & Society_, 9(2).
- Masur, P. K., DiFranzo, D., & Bazarova, N. N. (2021). [Behavioral contagion on social media: Effects of social norms, design interventions, and critical media literacy on self-disclosure](https://doi.org/10.1371/journal.pone.0254670). _PLOS ONE_, 16(7), e0254670.
- Bhandari, A., Ozanne, M., Bazarova, N. N., & DiFranzo, D. (2021). Do you care who flagged this post? Effects of moderator visibility on bystander behavior. _Journal of Computer-Mediated Communication_, 26(5), 284–300. The [Who flagged this?](/studies/flag-source) example is a rebuild of this design.
- Taylor, S. H., DiFranzo, D., Choi, Y. H., Sannon, S., & Bazarova, N. N. (2019). Accountability and empathy by design: Encouraging bystander intervention to cyberbullying on social media. _Proceedings of the ACM on Human-Computer Interaction_, 3(CSCW), 1–26.
- DiFranzo, D., Choi, Y. H., Purington, A., Taft, J. G., Whitlock, J., & Bazarova, N. N. (2019). Social Media TestDrive: Real-world social media education for the next generation. _CHI '19_. TestDrive was built from Truman's code.
- DiFranzo, D., Taylor, S. H., Kazerooni, F., Wherry, O. D., & Bazarova, N. N. (2018). Upstanding by design: Bystander intervention in cyberbullying. _CHI '18_. The first Truman study, on EatSnap.Love.
- DiFranzo, D., & Bazarova, N. N. (2018). The Truman Platform: Social media simulation for experimental research. Workshop paper, ICWSM '18.

Labs at UCL and VU Amsterdam have also run Truman studies that aren't published yet.

## Papers about Truman

These review or recommend it. They aren't studies run on it.

- Grüning, D. J., Kamin, J., Saltz, E., Acosta, T., DiFranzo, D., Goldberg, B., Leavitt, A., Menczer, F., Musgrave, T., Wang, Y., & Wojcieszak, M. (2025). Independently testing prosocial interventions: Methods and recommendations from 31 researchers. _Annals of the New York Academy of Sciences_, 1550, 108–121. Uses Truman as its worked example.
- Jagayat, A., & Choma, B. L. (2024). A primer on open-source, experimental social media simulation software: Opportunities for misinformation research and beyond. _Current Opinion in Psychology_, 55, 101726. Compares three simulators, Truman among them.

## Funding

| Funder                             | Award                                                                                                           | What it paid for                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| National Science Foundation        | IIS-1405634, PI Natalie Bazarova                                                                                | The original Truman and its first studies               |
| Cornell Center for Social Sciences | "Digital Behaviors in the Digital Age"                                                                          | Participant recruitment for the self-disclosure studies |
| USDA NIFA Hatch                    | 2020-21-276                                                                                                     | The AI moderator study (Ozanne et al., 2022)            |
| National Science Foundation        | "Deterring Objectionable Behavior and Fostering Emergent Norms in Social Media Conversations," PI Drew Margolin | VidShare and the objection and norms studies            |
| National Science Foundation        | IIS-2313078, "Collaborative Upstanding," PI Qian Yang                                                           | Truman Agents                                           |
| Lehigh University                  | Faculty start-up funds                                                                                          | Truman development at Lehigh, and the Lehigh studies    |

Truman 3 was built at Lehigh without a dedicated grant.

## People

**Creators**

- **Dominic DiFranzo** (Lehigh University) created Truman, has led development of every version, and leads Truman 3. [difranzo.com](https://difranzo.com)
- **Natalie Bazarova** (Cornell University) co-created Truman and directs the Cornell Social Media Lab, where it began.

**Contributors**

- **Winice Hui** maintained Truman 2 and VidShare.
- **Zhila Aghajari** ran the misinformation and community norms studies.
- **Qian Yang** led Truman Agents.
- **Philipp Masur** ran the self-disclosure studies, and runs Truman at VU Amsterdam.
- **Marie Ozanne** ran the moderation studies.
- **Pengfei Zhao** and **Inhwan Bae** ran the VidShare objection and norms studies.
- **Jessie Jia**, **Beichen Ma**, and **Asad Nabi** worked on Truman Agents and Truman development.
- **Anna Spring** helped develop the simulation for the AI moderator study.

**Co-authors of the first Truman papers**

- Samuel Hardman Taylor, Franccesca Kazerooni, and Olivia Wherry: _Upstanding by Design_, CHI 2018.
- Yoon Hyung Choi and Shruti Sannon: _Accountability and Empathy by Design_, CSCW 2019.
- Aparajita Bhandari: the moderation studies, 2021 and 2022.
- Jessie Taft helped with participants and content for the first study.

## In the news

- Cornell Chronicle, February 2018: [Upstanding by design: built-in encouragement to call out cyberbullies](https://news.cornell.edu/stories/2018/02/upstanding-design-built-encouragement-call-out-cyberbullies)
- Cornell Chronicle, October 2022: [Trust in online content moderation depends on moderator](https://news.cornell.edu/stories/2022/10/trust-online-content-moderation-depends-moderator)

## Using it

Researchers sign in or apply at [app.truman-research.org/admin](https://app.truman-research.org/admin/). The code is at [github.com/Critical-Computing-Cadre/truman3](https://github.com/Critical-Computing-Cadre/truman3), under the MIT license. If code is carried over from an older Truman, its copyright notices stay with it.
