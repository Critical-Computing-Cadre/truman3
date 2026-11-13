---

title: About
description: What Truman is, where it came from, the papers that used it, and how to cite it.
---

# About

Truman is an open-source platform for running experiments on a simulated social media site. A researcher writes the posts and the people who post them. Participants use the site the way they'd use any other. The researcher gets a record of what each participant saw and did.

The name comes from _The Truman Show_.

## History

Truman began at the Cornell Social Media Lab, which Natalie Bazarova directs, while Dominic DiFranzo was a postdoc there. The lab wanted to know whether a site's design could get bystanders to step in when they saw cyberbullying. That isn't an experiment anyone can run on a real platform, so they built a site to run it on.

That site was EatSnap.Love, a food-photo app. Participants used it for three days, posting and commenting alongside other users who were all scripted. The study was published at CHI in 2018.

The code was released under the MIT license, and other labs picked it up for their own studies: on moderation, self-disclosure, misinformation, and online safety for teens, among others. Each study was a fork of the code with its own posts and conditions. Some forks became projects of their own, including Social Media TestDrive, VidShare, Truman_SocialSim, and Truman Agents. In 2023 the Cornell lab released a cleaned-up Truman 2.

Forking had a cost. A fix made for one study never reached the others, and starting a study meant editing code. Truman 3, started at Lehigh University in 2026, is a rewrite that makes a study a set of content and settings. Researchers build one in the browser, pick the kind of site participants see, and can have a model play some of the cast. A lab can use the hosted version or run its own.

## Versions

| Version    | What it was                                                                    |
| ---------- | ------------------------------------------------------------------------------ |
| Truman 1   | The original, at `cornellsml/truman`. Each study was a fork                    |
| Truman 2   | Cornell's cleanup, at `cornellsml/truman_2023`, maintained by Winice Hui       |
| Extensions | Truman Agents, Truman_SocialSim, VidShare, and others, built on Truman 1 and 2 |
| Truman 3   | The rebuild this site is about, at `Critical-Computing-Cadre/truman3`          |

Truman 3's AI cast builds on ideas from Truman Agents, by Qian Yang and the Cornell DesignAI Group.

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

Truman was started by Dominic DiFranzo and Natalie Bazarova at Cornell. Dominic, now at Lehigh University, leads Truman 3.

Many others have built it, maintained it, or run studies that shaped it:

- **Winice Hui** maintained Truman 2 and VidShare.
- **Qian Yang** led Truman Agents.
- **Jessie Jia**, **Beichen Ma**, and **Asad Nabi** worked on Truman Agents and on Truman itself.
- **Zhila Aghajari** ran the misinformation and community norms studies.
- **Philipp Masur** ran the self-disclosure studies, and runs Truman at VU Amsterdam.
- **Marie Ozanne** and **Aparajita Bhandari** ran the moderation studies. **Anna Spring** helped build the simulation for the AI moderator study.
- **Pengfei Zhao** and **Inhwan Bae** ran the VidShare objection and norms studies.
- **Samuel Hardman Taylor**, **Franccesca Kazerooni**, **Olivia Wherry**, **Yoon Hyung Choi**, and **Shruti Sannon** were co-authors of the first bystander studies. **Jessie Taft** helped with participants and content for the first one.

## In the news

- Cornell Chronicle, February 2018: [Upstanding by design: built-in encouragement to call out cyberbullies](https://news.cornell.edu/stories/2018/02/upstanding-design-built-encouragement-call-out-cyberbullies)
- Cornell Chronicle, October 2022: [Trust in online content moderation depends on moderator](https://news.cornell.edu/stories/2022/10/trust-online-content-moderation-depends-moderator)

## Getting it

The code is at [github.com/Critical-Computing-Cadre/truman3](https://github.com/Critical-Computing-Cadre/truman3), under the MIT license. Labs can apply to use the hosted version at [app.truman-research.org/admin](https://app.truman-research.org/admin/).
