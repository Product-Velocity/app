// The craft behind the PV skills (issue #565, depth pass): the ideas a method rests on, when not to use it, the mistakes that spoil it,
// what to check before delivering, and a strong and a weak example. Written for Product Velocity from general product practice; examples use
// the fictional workspace "Meridian Media". Merged into the specs by skills-catalog.ts.

import type { SkillDepth } from "./skills";

export const SKILL_DEPTH: Record<string, SkillDepth> = {
  "pv-premortem": {
    concepts: [
      "A pre-mortem works because it changes the question. \"What could go wrong?\" invites defence of the plan; \"it has failed, so what happened?\" invites explanation. People who would never voice a doubt about a plan will describe a failure that is imagined as already done.",
      "Individual reasons come before discussion. The first reason spoken anchors everything after it, so the person's own reasons are written down first and the assistant's proposals are added after, labelled as proposed.",
      "A risk is only manageable if something would show early. For every serious risk ask what would be visible three weeks before it bites, and where: a field, a dependency's health, a date, a report. A risk with no early signal can only be accepted or designed out.",
      "Mitigation and contingency are different. A mitigation lowers the chance now; a contingency is what you do if it happens anyway. High-impact risks need both, and \"monitor closely\" is neither.",
      "Timing decides the value. Before Gate B the plan is still cheap to change; after Build starts the same insight costs rework. A pre-mortem is a tool for the moment when changing the plan is still affordable.",
    ],
    whenNot: [
      "There is only an idea and no plan yet. Nothing can fail that has not been planned; write a one-pager or a discovery first.",
      "The initiative has already shipped and missed. Use the outcome review (pv-outcome) to learn from what actually happened.",
      "The decision is final and cannot change whatever is found. A pre-mortem would only create worry; prepare contingencies instead and say that is what this is.",
      "The question is which of several options to choose. That is a comparison (pv-business-case or pv-prioritise); a pre-mortem tests one plan.",
    ],
    pitfalls: [
      { name: "Generic risks", why: "\"Technical risk\" and \"resource risk\" tell nobody what to watch or do.", fix: "Each reason names a specific event, what it touches and roughly when." },
      { name: "Only technical failures", why: "Customers, partners, legal, adoption and the team's own capacity fail plans as often as code does.", fix: "Walk every group: customer, build, market, people and capacity, dependencies, compliance and trust." },
      { name: "Risks without signals", why: "A list of worries cannot be watched.", fix: "Give each top risk an earliest signal and where it would show in Product Velocity or a named source." },
      { name: "Mitigation theatre", why: "\"Communicate regularly\" and \"keep an eye on it\" feel like action and change nothing.", fix: "A mitigation is a concrete step, with a role and a date, that makes the risk smaller or the damage cheaper." },
      { name: "Blaming people", why: "Reasons attributed to individuals make the exercise unsafe and the next one dishonest.", fix: "Write situations and conditions, never names; owners are for actions, not for faults." },
      { name: "Flat lists", why: "Twenty equally weighted risks hide the three that matter.", fix: "Merge duplicates, rank, and keep the top five to ten with the reason for their order." },
    ],
    checks: [
      "Every top risk has an earliest signal that someone could actually observe, and says where.",
      "Each reason is specific: an event, what it affects, roughly when.",
      "At least one reason comes from each of customer, build, dependencies and people or capacity, or the skipped group is named.",
      "The person's own reasons are present and labelled as theirs, and come first.",
      "Nothing is attributed to an individual.",
      "Likelihood and impact are marked as proposed, and nowhere written into a field.",
      "Plan changes are few (five at most), concrete, and described as suggestions that were not applied.",
      "Anything invented for the story is marked as illustration, and every fact has its source (field, document or the person).",
    ],
    example: {
      good: "Partner rights are not signed by 15 February, so the launch catalogue covers 2 of 5 networks and the promise in the release note is false. Earliest signal: no signed term sheet three weeks before launch (a dependency row on R-04 still showing \"to define\"). Mitigation: launch with the two signed networks and announce the rest as they sign; owner to name, decide by 1 February.",
      weak: "Partner delays could affect the timeline. Mitigation: communicate regularly with partners.",
      why: "The strong one names an event, a consequence, a date, a visible signal and an action that changes the outcome. The weak one could be pasted into any initiative.",
    },
  },

  "pv-metrics": {
    concepts: [
      "Measure the change, not the delivery. \"Shipped five features\" is output; \"more listeners finish an episode\" is an outcome. A metric earns its place by moving when customers get value, and by not moving when they do not.",
      "Pair a metric that confirms with one that warns. A lagging metric (ninety-day retention) tells you whether it worked but too late to act; a leading one (activation in the first week) lets you steer. Name at least one of each where you can.",
      "One primary key result per initiative. A second primary dilutes ownership and lets a team celebrate the easier one. Everything else is a signal or a guardrail.",
      "A target needs a baseline. Without today's value nobody can say whether a target is ambitious or trivial. If no baseline exists, the first deliverable is the measurement, and the plan says so.",
      "Guardrails keep a win honest. Every metric can be improved by damaging something else (faster checkout that raises refunds). Name what must not get worse and the limit.",
      "Say what else moves the number. Seasonality, a concurrent launch or a price change can look like success or failure; state how the effect will be separated (a holdout, a before-and-after window, a segment).",
      "Instrumentation is part of the work. If the event does not exist, adding it is scope, not an afterthought.",
    ],
    whenNot: [
      "There is no problem or hypothesis yet. Metrics without a belief to test are decoration; write the hypothesis first (pv-hypothesis).",
      "The goal is to explain a result that already happened. Use the outcome review (pv-outcome).",
      "The work is risk or maintenance with no customer behaviour to move (an upgrade, tech debt). Still define success, but as the specific measure it is (incidents, toil hours, build time), and do not force a customer metric onto it.",
    ],
    pitfalls: [
      { name: "Vanity metrics", why: "Sign-ups and page views rise without anyone getting value.", fix: "Tie the metric to the moment a customer gets value, and say what that moment is." },
      { name: "Output as outcome", why: "Counting what the team shipped measures the team, not the customer.", fix: "Ask what a customer does differently if it works, and measure that." },
      { name: "Target without baseline", why: "A number with no starting point cannot be judged.", fix: "Write the current value and its source, or make measuring it the first task." },
      { name: "Metric soup", why: "Ten metrics let any result be called a success.", fix: "One primary, up to three guardrails, a few signals." },
      { name: "Averages that hide", why: "A mean can improve while the slowest or newest users get worse.", fix: "Use a percentile or a segment when the spread matters, and say which." },
      { name: "Gameable metrics", why: "People optimise what is measured, even at the goal's expense.", fix: "Pair the metric with a counter-metric that would expose gaming." },
      { name: "No read-out", why: "A metric nobody reads on a date is not a commitment.", fix: "Give each a checkpoint and a reader, aligned with the 30, 60 and 90 day reviews." },
    ],
    checks: [
      "The primary metric has a unit, a direction, a time window and a named source.",
      "A baseline is present and sourced, or its absence is stated and the measurement is planned.",
      "The target is the person's number, or is marked \"to define\".",
      "At least one guardrail has a limit and a reason.",
      "Missing instrumentation is listed with the smallest step to add it.",
      "Read-out dates match the outcome review checkpoints and have a reader.",
      "The Values block repeats section 2 exactly, with plain numbers and the allowed values for unit and direction.",
      "No value, revenue or confidence figure was written anywhere.",
    ],
    example: {
      good: "Episodes completed per weekly mobile listener; count; increase; 3.1 now (events table, last 8 weeks) to 3.8, read 60 days after roll-out. Guardrail: crash rate must not rise above today's level. Gap: there is no \"played offline\" event yet; add it to the player first.",
      weak: "Increase engagement and reduce churn.",
      why: "The strong version can be wrong: it has a number, a source, a date and a way to fail. The weak one cannot be shown to have succeeded or failed.",
    },
  },

  "pv-one-pager": {
    concepts: [
      "A one-pager exists to get one decision, not to describe work. If a reader cannot say what they are being asked to decide after the first two lines, the page has failed however good the rest is.",
      "Problem before solution. A reader accepts a solution only after agreeing the problem is real, sized and theirs; a page that opens with the answer gets argued with at the wrong level.",
      "Say what you are not doing. Exclusions build trust, show the thinking and prevent scope drifting back in after approval.",
      "Label evidence by kind. A number, a customer's words and an observed behaviour carry different weight; a belief is allowed, but it is called a belief.",
      "Right-size it. For a small bet half a page is enough; for a large one the page is the front door to the PRD, not a substitute for it.",
      "Know which gate it serves. Gate A asks whether the problem and chosen solution are worth defining; Gate B asks whether to commit to build. The page should answer the question of the gate it is for.",
    ],
    whenNot: [
      "The task is to specify the work. Write the PRD; a one-pager that tries to be a spec fits neither purpose.",
      "There is no evidence yet. Run discovery first; a page full of beliefs asks the reader to approve a guess.",
      "The decision is already made. Write the plan or the PRD instead.",
      "The reader needs to be moved by a story of the customer's day. A PR/FAQ (pv-pr-faq) does that better.",
    ],
    pitfalls: [
      { name: "Burying the ask", why: "A reader who finds the request in paragraph four has already formed an opinion on the wrong thing.", fix: "State the decision, who decides and by when in the first two lines." },
      { name: "Solution first", why: "Without an agreed problem the solution looks like a preference.", fix: "Order it: ask, problem, who and why now, then the bet." },
      { name: "A feature list as a problem", why: "\"Users do not have X\" describes a gap in the product, not a problem for the customer.", fix: "Describe what the person is trying to do and what stops them." },
      { name: "Unlabelled beliefs", why: "Opinions presented as facts erode trust the first time one is checked.", fix: "Mark each claim as evidence (with its source) or belief." },
      { name: "No why now", why: "Without urgency the decision is easily deferred.", fix: "Name what changes if it waits: a date, a competitor, a cost, a window." },
      { name: "No sense of cost", why: "The decider cannot weigh a bet whose size is hidden.", fix: "Include the effort size from the initiative and what it displaces, or say it is to define." },
      { name: "Everything in scope", why: "An empty \"will not do\" section means nothing was decided.", fix: "List at least two things that are out, and why." },
    ],
    checks: [
      "The decision, the decider and the date are in the first two lines.",
      "The problem has at least one piece of evidence with its source, or the page says it has none.",
      "Why now is concrete.",
      "The bet is falsifiable: IF, THEN, RESULTING IN, copied from the initiative when it has them.",
      "Success names a metric and target from the key result fields, or says \"to define\".",
      "There are at least two things the work will not do.",
      "Every claim is labelled evidence or belief.",
      "It fits one page, about 400 words, and the team table comes from the person's own words.",
    ],
    example: {
      good: "Decision wanted: approve R-04 to enter Build by Friday (leadership meeting). Why now: two competitors ship offline in Q2 and our commuter churn peaks in January. Not doing: offline on web, paid downloads.",
      weak: "This document describes our vision for the future of listening and the many opportunities offline playback could unlock across the platform.",
      why: "The strong opening can be answered yes or no by the right person in a minute. The weak one gives nobody anything to decide.",
    },
  },

  "pv-gate": {
    concepts: [
      "A gate is a decision about commitment, not a review of work. The Approver is asked whether the organisation should commit the next stage of effort, so the brief answers that question and shows the evidence for it, rather than describing everything that was done.",
      "Lead with the decision and its options. The Approver chooses Go, Go with conditions, Hold or Stop; the brief states what each would mean for this initiative, so the choice is clear before the evidence is read.",
      "Separate fact from opinion. What the checklist, the documents and the data say is stated as such with its source; what the author thinks is marked as opinion, and the recommendation is marked as proposed.",
      "Completeness is not readiness. A fully ticked checklist does not make an idea good and a missing item does not make it bad; the brief reports both, and what the gaps would cost to close.",
      "Reversibility sets the bar. A decision that is cheap to undo needs less evidence than one that commits a team for a quarter; say which this is.",
      "A condition is only worth setting if it can be checked. \"Go with conditions\" needs conditions that have an owner and a date and a test, because each becomes a tracked task.",
    ],
    whenNot: [
      "No gate is near and nobody has asked for one. Write a one-pager or work on the evidence instead.",
      "The initiative has almost no documents or fields filled. The pack would be a list of gaps; say what to produce first (discovery, PRD, estimate) and stop there.",
      "The decision is not a gate decision (a priority call, a scope cut). Use pv-prioritise or the quarter plan.",
      "The person wants the gate passed. This skill prepares the case for a person to decide; it never requests, decides or approves a gate.",
    ],
    pitfalls: [
      { name: "An advocacy brief", why: "A one-sided case costs the Approver's trust and misses the question they must answer.", fix: "Give the strongest case for going and the strongest case against, and say which way the evidence leans." },
      { name: "Burying the gaps", why: "A gap found by the Approver after approval is a broken promise.", fix: "List what is missing in its own section, with who could supply it and what it would change." },
      { name: "Claiming readiness the data does not show", why: "\"Ready\" in the brief and incomplete in the checklist destroys credibility.", fix: "Quote the checklist as it stands and mark anything beyond it as opinion." },
      { name: "Conditions without owners", why: "They become wishes and the gate passes on trust.", fix: "Each proposed condition has a test, an owner role and a date." },
      { name: "Hiding the recommendation", why: "The Approver has to guess what the author thinks.", fix: "State a proposed recommendation, with reasons, and make it clear it is a proposal." },
      { name: "Length", why: "A long brief is not read; the decision is made on the first page.", fix: "The decision and the recommendation fit on one screen; the detail follows." },
    ],
    checks: [
      "The gate, what approving means for this initiative, the decider and the date are stated first.",
      "The checklist is quoted as it stands (filled and missing), not summarised away.",
      "Every statement of evidence names its source: a field, a document and its status, a past decision.",
      "The case against and the risks are present and honest.",
      "Gaps are listed with who could close them and what closing them would change.",
      "All four options (Go, Go with conditions, Hold, Stop) are described for this initiative; any proposed condition has a test, an owner role and a date.",
      "The recommendation is marked as proposed, with reasons, and the brief makes no claim to have requested or decided anything.",
      "Questions the Approver is likely to ask are listed with the answer or \"unknown\".",
    ],
    example: {
      good: "Gate B, due Friday. Approving commits the Playback and Mobile teams to R-04 for about 10 weeks and moves it into Build. Checklist: 7 of 9 filled; missing the estimate range and the partner rights status. Case against: the rights dependency has no signed term sheet. Proposed recommendation: Go with conditions: signed term sheet from at least two networks by 1 February (owner: product manager).",
      weak: "R-04 is a great opportunity with strong potential and the team is excited to start. We recommend approving.",
      why: "The strong brief says what is being committed, shows the checklist as it is, states the risk and proposes a checkable condition. The weak one asks for trust.",
    },
  },

  "pv-prioritise": {
    concepts: [
      "Prioritisation frameworks answer different questions. RICE and ICE compare value per effort across many candidates; WSJF weighs the cost of delay against the size of the job and suits time-critical work; MoSCoW cuts scope against a fixed date and is not a ranking; Kano separates must-haves from delighters for features; a value-versus-effort grid is a conversation tool for a workshop.",
      "Choose the method from the situation, not from habit. Stage (finding fit or scaling), what the decision is (what next, what to cut, in what order), and which data can be trusted decide the method; a precise formula fed with guesses gives false confidence.",
      "Scores are an aid to a conversation, not an answer. Their value is in making assumptions visible and comparable; the moment a score is treated as the decision, the inputs stop being challenged.",
      "Confidence is part of the score. Two initiatives with the same expected value are not equal if one rests on evidence and the other on a hunch; discount the less supported one and show how.",
      "Look at how fragile the order is. Say which input, if it changed by one step, would reorder the top of the list. A ranking that flips under small changes is a tie and should be treated as one.",
      "Dependencies and strategy override arithmetic. Something that unblocks three others, or that no longer fits the strategy, moves regardless of its score.",
      "Alignment is evidence, not a vote to obey. How consistently the people who were asked ranked an item (the crowd score, consensus and vote count, aggregated and never individual) is one input; low consensus is a reason to talk, not a reason to drop.",
    ],
    whenNot: [
      "There are fewer than about five candidates. Discuss them; scoring a handful adds ceremony.",
      "A fixed external date decides what ships. Cut scope against the date (MoSCoW) rather than ranking by value.",
      "The candidates serve different objectives and are not comparable. Rank within each objective first, or decide the objective split before scoring.",
      "Nobody has an effort or size estimate for most candidates. Scoring would be invention; gather estimates first and say so.",
      "The person wants Stack Rank set. This skill proposes an order; the final order is decided by people in Product Velocity.",
    ],
    pitfalls: [
      { name: "False precision", why: "A score of 7.34 against 7.20 implies a difference the inputs cannot support.", fix: "Use ranges or bands and call near-equal scores a tie." },
      { name: "The wrong framework for the stage", why: "A value-per-effort formula needs reach and revenue data that an early product does not have.", fix: "Pick the method from the stage and the data actually available; say what the method ignores." },
      { name: "One person scoring alone", why: "A single view is mistaken for a team judgment and misses what others know.", fix: "Use the alignment aggregates and mark every score that rests on one person's estimate." },
      { name: "Ignoring confidence", why: "A confident guess outranks a modest, well-supported idea.", fix: "Show confidence next to every score and discount low-evidence items visibly." },
      { name: "Dependency blindness", why: "Doing the highest score first can block three others.", fix: "Check dependencies before finalising the order and say where they override scores." },
      { name: "Treating the output as final", why: "The list becomes the decision and the inputs are never revisited.", fix: "Present it as a proposal with its fragile points, to be used in the decide-final-order step." },
      { name: "Inventing inputs", why: "A missing estimate filled with a plausible number poisons the ranking.", fix: "Leave it \"to define\", mark the score as partial and say what is needed." },
    ],
    checks: [
      "The framework is named with the reason it fits the person's answers, and with what it ignores.",
      "Every input says where it came from: a field, the alignment aggregates, or the person.",
      "No input was estimated by you; missing ones are \"to define\" and the affected scores are marked partial.",
      "Formulas are shown so the arithmetic can be checked.",
      "Confidence and the fragile points are reported, with the input that would reorder the top.",
      "The alignment aggregates are used only as aggregates; no individual is named and hidden groups are not inferred.",
      "The differences from the current Stack Rank are listed and none is applied.",
      "Nothing was written to Stack Rank, Value, Confidence or any field.",
    ],
    example: {
      good: "RICE chosen: growth stage, reach is measurable, effort estimates exist for 9 of 12. R-04 scores 18 (reach 40k listeners, impact medium, confidence 70%, effort L); R-09 scores 17: within the margin, so a tie. The order flips if R-04's effort moves from L to XL. R-11 has no estimate: scored partial, kept off the ranking until sized.",
      weak: "R-04 = 8.7, R-09 = 8.2, R-11 = 7.9. Recommended order: R-04, R-09, R-11.",
      why: "The strong output shows its method, inputs and weak points, and refuses to rank what it cannot score. The weak one hides how the numbers arose.",
    },
  },

  "pv-hypothesis": {
    concepts: [
      "A hypothesis is a falsifiable claim that links something you will do to something you will observe. If no result could prove it wrong, it is a hope, however well written.",
      "Specific beats broad. Who changes, what changes, by how much, and by when. \"Improve the experience\" cannot fail; \"more mobile listeners finish an episode within 60 days\" can.",
      "The reason is the learning. The \"because\" records why you believe it; when a test fails, the reason is what you revise. Only write a reason you have evidence for, and label the rest as assumption.",
      "Hypotheses come in kinds. Will people want it (value), can they use it (usability), can we build it (feasibility), will it pay off (viability). Each needs a different test, so say which one you are writing.",
      "One change at a time. A hypothesis that bundles several changes cannot say which one worked; split it, or state that the bundle is the unit being tested.",
      "Write it before the result. A hypothesis fitted to data after the fact looks like a hit and proves nothing.",
    ],
    whenNot: [
      "The decision is made and the question is how to build it. Write the PRD or the plan.",
      "There is no observable outcome (a compliance change, a required upgrade). State it as a requirement with its deadline instead.",
      "The idea is a bundle of many changes. Split it first (pv-opportunity-tree or pv-split), then write one hypothesis per change.",
      "The person wants a number proven right. This skill writes a claim that can fail, and says what failure would look like.",
    ],
    pitfalls: [
      { name: "Untestable wording", why: "Words like better, improved and engaged cannot be seen to fail.", fix: "Name an observable change, a population and a period." },
      { name: "Confirmation by design", why: "A claim that cannot fail teaches nothing.", fix: "Write what result would count against it and the threshold." },
      { name: "Several changes at once", why: "Success or failure cannot be attributed.", fix: "One change per hypothesis, or say the bundle is what is tested." },
      { name: "A metric nobody can see in time", why: "A result that arrives after the decision is moot.", fix: "Choose a measure that can be read within the test window, or a leading one." },
      { name: "Writing it after the fact", why: "The claim bends to fit the result.", fix: "Date it and fix it before any result is read." },
      { name: "A solution in disguise", why: "\"IF we build X\" describes work, not a belief about people.", fix: "State the behaviour you expect to change and why." },
      { name: "A reason with no evidence", why: "An invented \"because\" makes a guess look informed.", fix: "Cite the evidence or mark the reason as an assumption to test." },
    ],
    checks: [
      "It has the three parts in order: IF, THEN, RESULTING IN, each on its own line in the exact format.",
      "THEN names an observable change in a named population.",
      "RESULTING IN names a metric that exists or says it must be added.",
      "BECAUSE is present only with evidence, otherwise it is listed as an assumption.",
      "What would prove it wrong is written, with the threshold if the person gave one.",
      "The kind (value, usability, feasibility, viability) is stated.",
      "It describes one change, or says the bundle is the test.",
      "The Values block holds the three lines exactly as written in section 2.",
    ],
    example: {
      good: "IF we let mobile listeners download episodes, THEN they complete more episodes per week, RESULTING IN a rise in episodes completed per weekly mobile listener. BECAUSE connection loss is the most cited reason for stopping (discovery v2, section 3). Wrong if the rise is under +0.1 after four weeks.",
      weak: "We believe offline mode will make users happier and more engaged with the platform.",
      why: "The strong one names a change, a population, a measure, a reason with a source and a way to be wrong. The weak one cannot be tested.",
    },
  },

  "pv-outcome": {
    concepts: [
      "An outcome review compares intent with reality. It starts from what was said would happen (the hypothesis, the key result, the success measures) and sets what happened beside it, so the result is judged against a promise made before it was known.",
      "Three checkpoints tell different stories. At thirty days you learn whether people found and tried it; at sixty whether they kept using it; at ninety whether the change held and the effect is real. Read each for its own question.",
      "Numbers come from people and sources, never from inference. Record a checkpoint only with figures the person stated, in their words, and say where they came from.",
      "Separate what happened from why. A result is a fact; an explanation is a claim. Mark each explanation as confirmed (with its evidence) or possible, and name how to test the possible ones.",
      "Keep, change, stop is the point. A review that ends in a list of observations has not helped; end with what to continue, what to change and what to retire, and who decides.",
      "Learning travels. State what the next initiative should do differently because of this one, so the review changes behaviour beyond this item.",
    ],
    whenNot: [
      "The initiative has not reached roll-out or has no checkpoint data yet. Use pv-metrics to define what will be measured and when.",
      "The aim is to design a test or decide before launch. Use pv-experiment or pv-gate.",
      "Someone wants the review to judge a person's performance. Reviews concern the work and the team, never an individual.",
    ],
    pitfalls: [
      { name: "Judging by hindsight", why: "A result looks obvious afterwards and the original uncertainty is forgotten.", fix: "Quote what was believed and how confident the team was at the time." },
      { name: "Inventing a number", why: "A filled-in figure for a missing checkpoint is worse than a gap.", fix: "Leave it blank, say where the figure would come from, and offer to draft a request (nothing is sent)." },
      { name: "Explaining success with luck and failure with skill", why: "It is flattering and wrong in both directions.", fix: "Test each explanation the same way and label what is unproven." },
      { name: "Ignoring the counterfactual", why: "Seasonality or another launch may explain the movement.", fix: "State what else changed in the period and how it was separated." },
      { name: "No decision at the end", why: "Observations without keep, change or stop change nothing.", fix: "End with a proposed decision and who takes it." },
      { name: "Averaging away the story", why: "A mean can hide a segment that did very well or badly.", fix: "Check the segments the hypothesis named." },
    ],
    checks: [
      "Intent is quoted from the initiative's own fields and documents, with their source.",
      "Every figure is the person's or a source's, in their words where recorded, and none was inferred.",
      "Each checkpoint (30, 60, 90) is covered, or marked not recorded with what is missing.",
      "Explanations are labelled confirmed or possible, with evidence or a test.",
      "What else changed in the period is stated.",
      "The review ends with keep, change and stop, and who decides.",
      "No statement concerns an individual's performance.",
      "Nothing was written to the outcome verdict or learning fields; recording a checkpoint went through the recording tool only after the person agreed.",
    ],
    example: {
      good: "Intended: episodes completed per weekly mobile listener from 3.1 to 3.8 (target set before roll-out). At 60 days the person reports 3.6, from the events dashboard. Likely reason (possible, untested): downloads were used on trains but not at home. Another launch (a playlist redesign) went live in week 3, so part of the lift may not be offline. Proposed: keep; test the home-use hypothesis; Maria decides.",
      weak: "The feature performed well and users loved it. We should do more of this.",
      why: "The strong review sets a result against a prior target, labels its explanations and names a decision. The weak one cannot be checked or acted on.",
    },
  },

  "pv-which": {
    concepts: [
      "Choose the skill by the decision or the deliverable the person needs, not by the topic. \"We are not sure this is worth doing\" needs evidence and a hypothesis; \"leadership wants a decision\" needs a gate brief or a business case; they look similar and are not.",
      "Where the initiative is in its life matters. A PRD before discovery asks readers to approve a guess; a pre-mortem on an idea has nothing to test. Read the phase from Product Velocity when an initiative is named, and recommend what the phase calls for.",
      "Evidence decides the next step. If the problem is not evidenced, the best skill is the one that gathers it; if the plan exists but is untested, the best skill is the one that tests it.",
      "Recommend one skill, then at most two alternatives. A long menu is a way of not deciding; say which fits best and why the others are second.",
      "Some situations are not skill jobs. A conversation to have, a decision only a person can make, or data that must be collected first are better named plainly than forced into a template.",
    ],
    whenNot: [
      "The person has already named the skill they want. Just run it.",
      "The question is how Product Velocity itself works. Answer from the Help pages and the product, not with a skill.",
    ],
    pitfalls: [
      { name: "Recommending the heaviest skill", why: "A full PRD for a half-formed idea wastes a day and misleads readers.", fix: "Match weight to evidence and decision size; start with the lighter skill." },
      { name: "Ignoring the phase", why: "Skills assume a stage; the wrong one produces polished nonsense.", fix: "Check the initiative's phase and gate status before recommending." },
      { name: "A long menu", why: "Five options leave the person where they started.", fix: "One best fit, up to two alternatives, with the difference between them." },
      { name: "Inventing a skill", why: "Promising something that does not exist loses trust.", fix: "Recommend only from the list; say plainly when nothing fits." },
      { name: "No input guidance", why: "The person runs the skill and meets questions they cannot answer.", fix: "Say what to bring: the initiative code, evidence, a date, who decides." },
    ],
    checks: [
      "The situation is restated in one line the person can correct.",
      "Exactly one best-fit skill is named, with why it fits and what it produces.",
      "No more than two alternatives are named, each with when it is better.",
      "Every recommended skill is in the list.",
      "What to bring and the command to run are given.",
      "If the situation is not a skill job, that is said plainly with the next step.",
    ],
    example: {
      good: "You are deciding whether R-04 should enter Build on Friday. Best fit: pv-gate R-04. It reads the gate pack and writes the case, the gaps and the options for the Approver; bring the date and who decides. Alternative: pv-premortem R-04 first if the team has not looked at risks. Not a skill job: the rights negotiation itself.",
      weak: "You could try a PRD, a business case, a pre-mortem, a one-pager, a hypothesis or a roadmap review.",
      why: "The strong answer chooses, explains and says what to bring. The weak one hands the decision back.",
    },
  },

  "pv-split": {
    concepts: [
      "A good slice is vertical: it cuts through every layer and gives a person something they can use, however small. A slice that is only a database or only a screen delivers nothing to learn from.",
      "Start from the thinnest path through the whole experience, then add. The spine comes first; options, edge cases, speed and polish are added in later slices.",
      "There are many ways to cut: by workflow step, by user type, by business rule, by data set, by platform, by quality level, by the simplest case first. Choose the cut that puts the riskiest belief in an early slice.",
      "Splitting is about learning as much as delivering. The first slice should reduce the biggest uncertainty, not just the easiest work.",
      "What is left out matters as much as what is in. Writing down what is deferred, and what would make it worth doing, stops scope returning through the back door.",
      "Slices should be independent enough to be reordered. If every slice needs the one before, the cut has probably followed the build order rather than the user's path.",
    ],
    whenNot: [
      "The work is already small enough to finish in one cycle. Splitting adds overhead; just plan it.",
      "The problem is not understood yet. Slices of a guess are still guesses; use pv-assumptions or discovery first.",
      "The person wants to estimate cost. This skill orders and cuts scope; it does not size it.",
    ],
    pitfalls: [
      { name: "Horizontal layers", why: "Frontend, backend and database slices deliver nothing usable until all three are done.", fix: "Cut through the layers so each slice is a thin working path." },
      { name: "Slicing by build order", why: "The order of construction is not the order in which people get value or the team learns.", fix: "Order by value and by the riskiest belief first." },
      { name: "The first slice is the easy one", why: "The hard question is left until late, when it is expensive to change course.", fix: "Put the riskiest assumption in the first or second slice." },
      { name: "Slices that cannot be shipped alone", why: "A slice that has to wait for the next one is a task, not a slice.", fix: "Check that each could go to a person on its own, even behind a flag." },
      { name: "Lost acceptance rules", why: "A rule from the original quietly vanishes when scope is cut.", fix: "List where each rule went: kept, moved or deferred." },
      { name: "A pile of tiny tasks", why: "Fifteen sub-day slices cost more in coordination than they save.", fix: "Keep slices to what the team can deliver and show in one cycle." },
    ],
    checks: [
      "Every slice is something a person can do or a belief that can be tested; none is a layer or a task.",
      "The thin end to end path is described and every slice relates to it.",
      "The slice with the riskiest assumption is early, and the reason is given.",
      "Every slice states what it depends on, or says none.",
      "The way each slice was cut is named.",
      "What is deferred is listed with what would make it worth doing.",
      "No size, week or cost appears unless the person or a document gave it.",
      "Nothing was created in Product Velocity; creating items is offered with a preview.",
    ],
    example: {
      good: "Slice 1: a listener on the phone app can download one episode on wifi and play it offline. It tests whether people use downloads at all (R-04's hypothesis). Deferred: auto-download, storage settings, tablets. Worth doing later if more than a tenth of listeners use download in the first month.",
      weak: "Slice 1: build the download service. Slice 2: build the download screen. Slice 3: build the storage manager.",
      why: "The strong slice is usable and tests a belief and says what waits. The weak list is three layers; nothing can be shown to a listener until all are done.",
    },
  },
  "pv-assumptions": {
    concepts: [
      "Every plan stands on beliefs that are rarely written down. Making them visible is the cheapest risk reduction there is; the risk lives in the unwritten ones.",
      "An assumption is a statement that could be false. \"Users want faster export\" is an assumption; \"build faster export\" is a task.",
      "Assumptions come in kinds. Desirable (people want it), viable (it pays off), feasible (we can build and run it), usable (they can work it out) and, where it applies, ethical or legal. A plan usually fails on the kind nobody checked.",
      "Rank by two things: how much the plan depends on it, and how little is known. The high-dependence, low-knowledge assumptions are the ones to test first.",
      "Test the cheapest way that could change your mind. Asking five people, a fake door, a prototype, a data pull: use the least costly test that could still show the assumption is wrong.",
      "Evidence has grades. A customer's behaviour beats what they say; what they say beats what colleagues believe. Mark which is which.",
    ],
    whenNot: [
      "The plan is already built and shipped. Use the outcome review (pv-outcome) to see what turned out true.",
      "The question is how to write the hypothesis. Use pv-hypothesis; this skill finds what to test, that one words it.",
      "The person wants a list of risks of failure in delivery. Use pv-premortem; this skill is about whether the idea is worth building.",
    ],
    pitfalls: [
      { name: "Wishes and tasks as assumptions", why: "\"We will launch in Q2\" cannot be tested as a belief.", fix: "Rewrite as something that could be false: \"customers will adopt within a quarter\"." },
      { name: "Compound statements", why: "Two claims in one cannot be tested separately.", fix: "One claim per row." },
      { name: "Only desirability", why: "Teams test whether people want it and skip whether it pays or can be run.", fix: "Check at least one assumption of each kind, or say which were skipped." },
      { name: "Believing your own evidence", why: "A colleague's opinion is recorded as evidence.", fix: "Grade the evidence: behaviour, stated, believed; cite sources." },
      { name: "Tests that cannot fail", why: "A survey that leads the answer proves nothing.", fix: "State in advance what result would show the assumption false." },
      { name: "Expensive first tests", why: "Building before asking wastes the lead time that tests exist to save.", fix: "Order by cost; run the cheapest decisive test first." },
    ],
    checks: [
      "Each assumption is a single claim that could be false.",
      "Each has a kind, an evidence grade and a source or says none.",
      "At least one assumption of each relevant kind appears, or the gap is named.",
      "The riskiest five are chosen by the stated two axes, and the placement is marked as proposed.",
      "Each of the five has a test, what would show it false, and a pass line from the person or \"to define\".",
      "The tests are in order of cost and decisiveness, and the plan change for a failure is stated.",
      "Settled assumptions cite the evidence that settles them.",
    ],
    example: {
      good: "Assumption 4 (desirable): commuting listeners lose the connection mid-episode often enough to stop listening. Evidence: stated, discovery v2 interviews (6 of 9). Test: look at where in the episode mobile sessions end, from the events dashboard. False if sessions end evenly through the episode.",
      weak: "Users will love offline mode and it will increase engagement.",
      why: "The strong version is one testable claim with its evidence graded and a way to be shown wrong. The weak one is a hope with no test.",
    },
  },
  "pv-sunset": {
    concepts: [
      "Retiring something is a product decision with a customer promise attached. People rely on what exists, and how you end it shapes trust more than the fact that you end it.",
      "Count the dependents before setting the date: other initiatives, integrations, reports, contracts and promises. A date set before this is a guess.",
      "Give people a path, not only a date. A replacement, a migration or an export, and a clear statement of what is lost. \"We are ending it\" without \"here is what to do\" produces escalations.",
      "Sequence the end: announce, stop new use, read-only, end, delete. Each step can be reversed until the last one, and the last one should come well after the user's last chance to act.",
      "Tell people in an order that avoids surprise. Staff who talk to customers hear first; customers hear from us, not from each other.",
      "Data has obligations. What is kept, for how long, and what customers can take with them are legal and trust questions; list them for the right people to answer.",
    ],
    whenNot: [
      "Only a temporary pause or a hide-behind-a-flag is meant. That is a roll-back, not a sunset.",
      "The decision to retire has not been made. First use pv-business-case or pv-prioritise to decide; this plan assumes it is decided.",
      "The thing is being replaced by something people use automatically with nothing to do. A short migration note is enough.",
    ],
    pitfalls: [
      { name: "A date with no path", why: "Customers hear that something is ending and not what to do.", fix: "State the replacement, the migration and what is lost." },
      { name: "Ignoring dependents", why: "Other teams and integrations break on the day.", fix: "List dependents from Product Velocity and from the person before fixing dates." },
      { name: "Telling customers first", why: "Support and sales are surprised by questions they cannot answer.", fix: "Plan internal communication before external." },
      { name: "Deleting too early", why: "Data is gone before the last chance to export it.", fix: "End use first, delete after a stated period." },
      { name: "Claiming a legal duty from memory", why: "Notice periods and contract terms differ by customer.", fix: "List them as questions for legal; cite the contract if the person gave it." },
      { name: "No early warning of damage", why: "The first sign of trouble is a customer leaving.", fix: "Name the signals and who watches them, and what would pause the plan." },
    ],
    checks: [
      "The reason and the dates are stated with their status (fixed, proposed, to define).",
      "Dependents are listed, with the source, or the gap is named.",
      "A path for customers is given, and what they lose.",
      "The timeline has announce, stop new use, read-only, end and delete steps, each with an owner role.",
      "Internal communication comes before customer communication.",
      "Data and legal questions are listed for the right owner and none is stated as law without a source.",
      "The phase, the dates and any message are marked as not changed or sent.",
    ],
    example: {
      good: "Step 3 (read-only): on 1 October the old export screen shows data but accepts no new jobs. Customers on the legacy plan get a banner and an email on 1 September with the steps to move to the new export. Support has a macro by 15 August. Data is kept 90 days after the end, as the person stated; legal to confirm the contract terms.",
      weak: "The old export will be discontinued at the end of Q3. Customers will be notified.",
      why: "The strong plan gives dates, steps, owners and what customers can do; the weak one is only an intent.",
    },
  },
  "pv-stakeholders": {
    concepts: [
      "Alignment is not agreement with everyone; it is that the people who decide, and the people who can block or must deliver, understand what is asked of them and have had the chance to say no early.",
      "Map by two things: how much they decide or influence, and how much the outcome affects them. Those who both decide and are affected need the most attention, early.",
      "Speak in their terms. A finance lead cares about cost and timing, support about volume and training, legal about obligation. The same initiative is a different story for each.",
      "Stance is evidence, not impression. Write what a person said or did, with its source; otherwise write unknown. A guessed stance becomes a self-fulfilling label.",
      "Order matters. Nobody should hear about a change that affects them from someone else. Decide who hears first and why.",
      "Product Velocity's alignment results are aggregate and anonymous. They show where the group stands, not who stands where, and the app hides groups that are too small to be anonymous.",
    ],
    whenNot: [
      "The initiative is small and affects only the team. A short note to the team is enough.",
      "The goal is to rate or rank people. This skill maps roles and positions on an initiative, never people's quality.",
      "The question is whom to put on the product team. That is a staffing decision for the person.",
    ],
    pitfalls: [
      { name: "A list of names", why: "A list of people says nothing about what each needs.", fix: "Say what each group decides, what affects them and what to bring." },
      { name: "Guessed stances", why: "Assumed opposition shapes how you approach people.", fix: "Mark unknown unless said or shown; cite the source." },
      { name: "Forgetting the quiet groups", why: "Support, legal and operations are skipped and block at the end.", fix: "Check the dependencies and the launch areas for missing groups." },
      { name: "One message for all", why: "The same pitch misses what each cares about.", fix: "Write the benefit, the cost and the question per group." },
      { name: "Treating the alignment result as individuals", why: "Trying to identify a voter breaks anonymity and trust.", fix: "Use aggregates only and say what they do not show." },
      { name: "No order of conversations", why: "Someone hears second-hand.", fix: "Decide who first, and why." },
    ],
    checks: [
      "Each stakeholder is a role or group; a person's name is there only if the person gave it.",
      "Each has what they decide or influence and how the outcome affects them.",
      "Each stance is marked with its source or as unknown.",
      "Each group has what they care about in their terms and what to bring.",
      "An order of conversations is given with the reason.",
      "Missing groups are listed and the risk of leaving them out is stated.",
      "The alignment aggregates are described as aggregates, with what they cannot show.",
      "Nothing was sent and no alignment round was opened.",
    ],
    example: {
      good: "Support (decides nothing, affected: ticket volume rises for two weeks). Stance: doubtful, per the March sync notes. Cares about: training time and a macro for the top three questions. Bring: the one-pager and a draft of the three answers, in the week before enablement. Talk to them before sales, who will ask them.",
      weak: "Support: should be fine with it. Sales: excited. Legal: will need to review.",
      why: "The strong entry gives influence, effect, a sourced stance, what to bring and when. The weak one is impression with no source and no action.",
    },
  },
  "pv-readiness": {
    concepts: [
      "Readiness is a list of things that can be checked, not a feeling. For each area there is a question with a yes, a no or an unknown, and a person who owns the answer.",
      "Unknown is not yes. A check without a source is open until someone confirms it, and the list says so plainly.",
      "A launch has more areas than the product: data and measurement, support, sales and enablement, comms, legal and privacy, security, operations, and the way back. Most late surprises come from the areas outside the product.",
      "Stage the launch when you can. A small group first, with a signal to continue and a signal to pause, turns a risky day into a series of small decisions.",
      "Rollback is part of the launch. If nobody can say how to undo it, or how long that takes, the plan is not ready.",
      "The first days need an owner. Who reads the signals, where issues go, and when the first read of the key result is taken, written down before launch.",
    ],
    whenNot: [
      "The initiative is still in Discover or Define. Use pv-gate to prepare the case for building; readiness comes after.",
      "The question is the story and messages for the market. Use pv-gtm; this skill checks that the pieces exist.",
      "Something is live and failing. That is an incident, not a launch review.",
    ],
    pitfalls: [
      { name: "Product-only checklist", why: "Support, legal and operations are found out about on launch day.", fix: "Walk every area; mark the ones that do not apply and why." },
      { name: "Done without a source", why: "A check is ticked because it feels done.", fix: "Say who confirmed it or which document shows it; otherwise mark unknown." },
      { name: "No rollback", why: "The first problem becomes an emergency.", fix: "Name the way back, who does it and how long it takes." },
      { name: "Everyone at once without a reason", why: "No chance to learn before the whole base is affected.", fix: "Offer a staged option, or say why it cannot be staged." },
      { name: "No owner on gaps", why: "Open items sit unassigned until the date.", fix: "Every open row has an owner role and a date, or is flagged." },
      { name: "Declaring ready", why: "The assistant's verdict is taken as the decision.", fix: "List evidence and gaps; a person decides." },
    ],
    checks: [
      "Every area appears, or is marked not applicable with a reason.",
      "Each done check has a source; everything else is open or unknown.",
      "Each open row has an owner role and a date or is flagged as without one.",
      "Rollback and monitoring are on the list, marked unknown if nothing says they exist.",
      "Blocking gaps are separated from nice-to-have.",
      "For a staged launch, the continue and the pause signals are stated.",
      "The key result and its first read are named.",
      "Nothing was said to be ready; the decision is left to the person, and no field other than the enablement notes is proposed.",
    ],
    example: {
      good: "Support: open. The macro for the three top questions is not written (owner: support lead, due 10 March). Source: no document found in Product Velocity; the person said it is in progress. Blocking: yes, tickets will go to a team without answers.",
      weak: "Support: should be ready by launch. Everything looks good overall.",
      why: "The strong row gives a status, a source, an owner, a date and whether it blocks. The weak one is a mood.",
    },
  },
};

// A worked example per deepened skill (a fictional workspace; they show the standard of work and the shape, not facts to reuse).
const WORKED: Record<string, { input: string; output: string }> = {
  "pv-premortem": {
    "input": "pv-premortem R-04, judged against the 15 March release. The person's own worries: download size on older phones, and rights holders not agreeing in time. Maria calls go, adjust or stop.",
    "output": "## 1. The failure story\nIt is 15 March and offline listening has not shipped as promised. Rights talks with two networks ran past February, so the offline catalogue was a fraction of the PRD's promise. On older phones the downloads filled storage and support tickets about app size outweighed the benefit. Build had started before Gate B, so rework landed in the last four weeks. (Illustration built from the PRD and the person's worries; no facts beyond them.)\n\n## 2. Reasons it failed\n| Group | Reason | Source |\n|---|---|---|\n| Dependencies | Rights holders do not agree in time | person's own |\n| Customer | Download size too large on older phones | person's own |\n| Build | Starting before Gate B means rework | from the PRD, roll-out plan |\n| Dependencies | R-02 (playback engine) is At Risk | from a dependency field |\n| Market | Competitors' offline modes set the expectation | proposed by Claude (profile, read 2026-09-12) |\n\n## 3. Top risks\n| Risk | Likelihood (proposed) | Impact (proposed) | Earliest signal, where | Mitigation | Owner |\n|---|---|---|---|---|---|\n| Rights not agreed by date | High | High | No signed term sheet by 15 Feb; the dependency row on R-04 still \"to define\" | Launch with the networks already signed | to name |\n| Download size on older phones | Medium | Medium | Beta users report storage warnings | Size cap; wifi-only downloads | to name |\n| R-02 slips | Medium | High | R-02 health stays At Risk for two weeks | Decide scope without it at Gate B | to name |\n\n## 4. Plan changes to consider\nSplit the launch by network; add a guardrail metric of storage warnings per 1,000 downloads. (Suggestions only.)\n\n## 5. Bets we are making\nListeners want offline for commuting, not only travel. Cheapest test: ask 20 current users in the app.\n\n## 6. Values for Product Velocity\n- dependencies_blockers: Rights agreements with two podcast networks; R-02 playback engine"
  },
  "pv-metrics": {
    "input": "pv-metrics R-04. If it works, listeners finish more episodes on the move. Measured as episodes completed per weekly mobile listener, now 3.1 in the analytics dashboard. Maria decides what worked: 3.8 or better 60 days after roll-out.",
    "output": "## 1. What should be different\nMobile listeners complete more episodes because losing the connection no longer interrupts them.\n\n## 2. The key result\nEpisodes completed per weekly mobile listener. Unit: count. Direction: increase. Start: 3.1 (analytics dashboard, as given). Target: 3.8 (as given). Read weekly from the events table, 60 days after roll-out.\n\n## 3. Signals around it\n| Signal | Metric | Baseline | Target | Source |\n|---|---|---|---|---|\n| Adoption | Share of mobile listeners who download at least one episode | to define | to define | new analytics event |\n| Task success | Offline plays that finish without error | to define | to define | playback logs |\n| Satisfaction | In-app survey rating of offline | to define | to define | survey |\n\n## 4. Guardrails\nCrash rate must not rise above today's level (limit as current). Storage warnings per 1,000 downloads (limit to define).\n\n## 5. What we cannot measure yet\nNo \"downloaded episode played offline\" event exists. Smallest step: add it to the player before roll-out.\n\n## 6. When we read it out\n30, 60 and 90 days after roll-out, matching the outcome reviews. Maria reads each.\n\n## 7. Values for Product Velocity\n- kr_metric: Episodes completed per weekly mobile listener\n- kr_unit: count\n- kr_direction: Increase\n- kr_start: 3.1\n- kr_target: 3.8"
  },
  "pv-one-pager": {
    "input": "pv-one-pager R-04 for the leadership meeting on Friday. Leadership decides whether R-04 enters Build. Evidence: churn analysis in the discovery and 14 support tickets. Not doing: offline on web, paid downloads.",
    "output": "| Role | Name |\n|---|---|\n| Product manager | Maria (as said) |\n| Designer | to define |\n| Engineering manager | to define |\n\n## 1. The ask\nLeadership decides by Friday whether R-04 enters Build.\n\n## 2. Problem\nMobile listeners lose playback in tunnels and on trains. The discovery (v2, section 3) records it as the most cited reason for leaving a session; 14 support tickets mention it (link given). Evidence, not belief.\n\n## 3. Who and why now\nCommuting listeners on mobile (profile persona). Two competitors already offer offline, per the profile (read 2026-09-12); commuter churn peaks in January (the person's data).\n\n## 4. The bet\nIF we let listeners download episodes, THEN mobile session length rises, RESULTING IN more weekly active listeners (copied from the initiative's hypothesis).\n\n## 5. How we will know\nKey result: weekly active mobile listeners; start and target to define; direction increase.\n\n## 6. What we will not do\nOffline on web. Paid downloads.\n\n## 7. Risks and open questions\nRights agreements; download size on older phones; who handles storage support. Effort: L (initiative field)."
  },
  "pv-gate": {
    "input": "pv-gate R-04. Gate B, due Friday, Maria decides. Concern raised outside Product Velocity: the two networks have not confirmed in writing.",
    "output": "## 1. The decision\nGate B, due Friday, decided by Maria. Approving commits the Mobile and Playback teams to R-04 for about 10 weeks, approves the PRD (v3, in review) and moves it into Build.\n\n## 2. Where it stands\nChecklist (gate pack): 7 of 9 filled. Missing: the estimate range and the partner rights status. Documents: PRD v3, in review (AI draft accepted by a person on 12 Nov); discovery v2, approved at Gate A; success metrics, AI draft. No open conditions.\n\n## 3. The case for going\nEvidence: churn analysis and 14 tickets (discovery v2); hypothesis and key result are set; two competitors ship offline in Q2 (profile, 2026-09-12). Why now: commuter churn peaks in January.\n\n## 4. The case against and the risks\nRights: no signed term sheet (outside Product Velocity, per the person). Dependency: R-02 is At Risk. The pre-mortem rates the rights risk high likelihood, high impact (proposed ratings).\n\n## 5. What is missing\nEstimate range (engineering manager, two days); partner rights status (product manager, depends on the networks).\n\n## 6. Options\n- Go: Build starts; the rights risk travels with it.\n- Go with conditions: proposed condition: signed term sheet from at least two networks by 1 February (owner: product manager).\n- Hold: review date 24 January; keeps the team free.\n- Stop: closes R-04; loses the January churn window.\n\n## 7. Proposed recommendation (proposed by Claude)\nGo with conditions. Reason: the evidence for the problem is solid and the main risk can be tested cheaply and soon. Would change if the networks decline.\n\n## 8. Questions the Approver will ask\nWhat does it displace? Unknown: not in Product Velocity. Who owns the rights talks? Product manager. What if one network refuses? Launch with the others."
  },
  "pv-prioritise": {
    "input": "pv-prioritise (no initiatives named, so all open ones). Growing product; deciding what to build next; reach and effort estimates trusted for most, revenue not.",
    "output": "## 1. Approach chosen\nRICE: the product is growing, reach is measurable and effort estimates exist for 9 of 12. It ignores strategic fit and dependencies, so both are checked in section 7. WSJF would suit if the person could state the cost of delay; they cannot yet.\n\n## 2. Inputs and where they came from\n| Input | Source | Coverage |\n|---|---|---|\n| Reach | the person's figures, listeners per quarter | 10 of 12 |\n| Impact | proposed by Claude from the key results (marked proposed) | 12 of 12 |\n| Confidence | confidence field as set by people | 8 of 12 |\n| Effort | Effort field (XS to XL) | 9 of 12 |\n\n## 3. Scores\n| Initiative | Reach | Impact | Confidence | Effort | Score (R x I x C / E) | Proposed rank |\n|---|---|---|---|---|---|---|\n| R-04 Offline listening | 40,000 | 2 | 70% | L (3) | 18.7 | 1 |\n| R-09 Playlist import | 25,000 | 2 | 70% | M (2) | 17.5 | 2 (tie) |\n| R-11 Social sharing | to define | 1 | to define | to define | partial, not ranked | |\n\n## 4. Where the ranking is fragile\nR-04 and R-09 are a tie within the margin. The order flips if R-04's effort moves from L to XL. R-09's reach rests on one person's estimate.\n\n## 5. Alignment check\nAggregates: R-04 has the highest crowd score (consensus high, 9 votes); R-09's consensus is low (6 votes). Low consensus is a reason to talk, not to drop it.\n\n## 6. Compared with the current Stack Rank\nCurrent order is R-09, R-04. The proposal swaps them; nothing is applied.\n\n## 7. Cut list and parked\nR-02 unblocks R-04 and overrides its score: do it first. R-11: park until sized.\n\n## 8. What would improve the ranking\nEffort for R-11 and R-12; reach for R-11; confidence for four initiatives."
  },
  "pv-hypothesis": {
    "input": "pv-hypothesis R-04. Mobile listeners who can download episodes will finish more of them. Mainly a value hypothesis. Wrong if the rise is under +0.1 after four weeks.",
    "output": "## 1. The belief in plain words\nCommuting mobile listeners stop mid-episode when the connection drops; if they can download ahead, they will finish more episodes.\n\n## 2. The hypothesis\nIF we let mobile listeners download episodes,\nTHEN they complete more episodes per week,\nRESULTING IN a rise in episodes completed per weekly mobile listener.\nBECAUSE connection loss is the most cited reason for stopping (discovery v2, section 3).\n\n## 3. Assumptions underneath\n1. Listeners will plan ahead and download (value; no evidence yet).\n2. Downloads play without errors on older phones (feasibility; untested).\n3. Rights allow enough of the catalogue (viability; two networks unconfirmed).\n\n## 4. How it can be proven wrong\nCompare a random half of mobile listeners with and without downloads for four weeks on episodes completed per weekly listener. Counts against it: a rise under +0.1 (threshold as given).\n\n## 5. Sharper and weaker forms\nSharper: only for listeners on trains, measured by sessions that start offline. Weaker: all listeners on all platforms, which would mix several effects.\n\n## 6. Values for Product Velocity\n- hypothesis: IF we let mobile listeners download episodes\nTHEN they complete more episodes per week\nRESULTING IN a rise in episodes completed per weekly mobile listener"
  },
  "pv-outcome": {
    "input": "pv-outcome R-04, the 60 day review. Figure: 3.6 episodes per weekly mobile listener, from the events dashboard. Possible reason: downloads used on trains, not at home. A playlist redesign went live in week 3.",
    "output": "## 1. What we intended\nHypothesis: letting mobile listeners download raises episodes completed. Key result: 3.1 to 3.8, read 60 days after roll-out (success metrics v1). Team confidence at the time: Medium (initiative field).\n\n## 2. What happened\n- 30 days: not recorded. The figure would come from the events dashboard; a request can be drafted (nothing is sent).\n- 60 days: 3.6, stated by the person from the events dashboard. Against target: 0.2 below; against baseline: +0.5.\n\n## 3. Why\n- Possible (untested): downloads are used on trains but not at home. Test: split offline plays by commute hours.\n- What else changed: a playlist redesign went live in week 3, so part of the lift may not be offline. Not separated yet; compare the listeners who never downloaded.\n\n## 4. What surprised us\nOlder phones downloaded less than expected (the person's observation, no figure).\n\n## 5. Keep, change, stop\nProposed: keep offline; change the home-use prompts; do not stop. Maria decides.\n\n## 6. What to carry forward\nRecord the other launches that overlap a roll-out before reading the result; add the \"played offline\" event before launch, not after."
  },
  "pv-which": {
    "input": "pv-which. \"Leadership wants to know on Friday whether R-04 should start building, and I am not sure the team has looked at the risks.\"",
    "output": "What I understood: R-04 needs a go or no go on Friday, and its risks have not been reviewed.\n\nBest fit: pv-gate R-04. It reads the gate pack and writes the case, the gaps and the four options for the person who decides. Bring: the gate (B), who decides and when, and anything raised outside Product Velocity. You get a saved brief on the initiative.\n\nAlternatives: pv-premortem R-04 if there is time first; it turns the team's worries into ranked risks with signals, and the gate brief can then use them. pv-business-case R-04 if the question is whether to build it at all or in another way.\n\nBefore and after: R-04 is in Define, so the documents the brief needs (PRD, success metrics) should exist; if not, run pv-metrics first. After the gate, pv-gtm plans the launch.\n\nNot a skill job: the rights negotiation with the networks is a conversation, not a document."
  },
  "pv-split": {
    "input": "pv-split R-04. Too big to finish in one quarter. The team can deliver and show something in a two-week cycle. Without offline playback the whole thing is pointless.",
    "output": "## 1. What is being split and why\nR-04 (offline listening on mobile) is too large for one quarter. Slices must be deliverable and showable in a two-week cycle (your limit).\n\n## 2. The thin end to end path\nA listener opens an episode, taps download on wifi, loses the connection and plays it anyway.\n\n## 3. Slices in order\n| # | A person can... | Tests | Size | Depends on |\n|---|---|---|---|---|\n| 1 | download one episode on wifi and play it offline | do listeners use downloads at all (hypothesis of R-04) | to define | none |\n| 2 | download on mobile data, with a warning | whether size on older phones is a barrier | to define | 1 |\n| 3 | auto-download a followed show | whether it lifts episodes completed | to define | 1 |\n\n## 4. How each slice was cut\n1: simplest case first (one episode, wifi). 2: by data channel. 3: by quality level (automation after manual).\n\n## 5. Deferred and why\nStorage settings and tablets are left out; worth doing if more than a tenth of listeners use downloads in the first month (to be confirmed by you).\n\n## 6. Risks in the order\nThe riskiest belief (listeners want to download) is tested by slice 1.\n\n## 7. What this changes in Product Velocity\nSuggestion: keep slices 1 to 3 inside R-04. I can show a dry run to create them as separate initiatives if you prefer; nothing is created until you agree."
  },
  "pv-assumptions": {
    "input": "pv-assumptions R-04. A quarter of work depends on it. Known: six of nine interviewed commuters lose connection mid-episode. Can wait three weeks to test.",
    "output": "## 1. The plan in one line\nLet mobile listeners download episodes so they finish more of them (key result 3.1 to 3.8 episodes per weekly listener).\n\n## 2. Assumptions\n| # | Assumption | Kind | Evidence | Amount |\n|---|---|---|---|---|\n| 1 | Commuters lose connection often enough to stop listening | desirable | stated, discovery v2 (6 of 9) | thin |\n| 2 | Listeners will plan ahead and download | desirable | none | none |\n| 3 | Downloads fit on older phones | feasible | none | none |\n| 4 | Rights holders allow offline use | viable | none | none |\n\n## 3. Map\nHigh dependence and little known: 2, 3 and 4. High dependence and some evidence: 1.\n\n## 4. The riskiest five\n2: if listeners do not plan ahead, the feature sits unused. Cheapest test: a download button that records taps, shown to 5% of listeners. False if fewer than your pass line (to define) tap it.\n\n## 5. Test order\n4 first (one conversation with the rights lead, a day), then 2 (three weeks), then 3.\n\n## 6. What the evidence already settles\nNothing is settled; 1 has thin, stated evidence only."
  },
  "pv-sunset": {
    "input": "pv-sunset R-19. Retiring the legacy export screen; the new export replaces it. End date proposed 1 October. Used by customers on the legacy plan.",
    "output": "## 1. What is ending and why\nThe legacy export screen, replaced by the new export. End: 1 October (proposed).\n\n## 2. Who is affected\nCustomers on the legacy plan; number to define (not in Product Velocity).\n\n## 3. What depends on it\nR-22 (scheduled reports) lists R-19 as a dependency; talk to its owner before the date is fixed.\n\n## 4. The path for customers\nThe new export covers CSV and Excel; PDF export is not covered, which is lost.\n\n## 5. Timeline\nAnnounce 1 September (comms lead); stop new jobs 1 October (read-only); end 1 November; delete data 90 days later (your stated period).\n\n## 6. Communication\nSupport and sales first, with a macro by 15 August; customers by email and banner 1 September. Draft wording follows, marked as a draft.\n\n## 7. Data and obligations\nExport rights and contract notice periods: for legal to confirm.\n\n## 8. Risks and a way back\nSupport spike in the first week; pause if tickets pass your threshold (to define). Initiative Phase is not changed; moving it to Sunset is your step."
  },
  "pv-stakeholders": {
    "input": "pv-stakeholders R-04. I need a decision at Gate B. I know that support and rights matter. I expect doubt from rights.",
    "output": "## 1. What alignment is needed\nA go at Gate B for R-04. The Approver role decides.\n\n## 2. The map\n| Group | Decides or influences | Affected by | Stance | Source |\n|---|---|---|---|---|\n| Product leadership | decides at the gate | high | unknown | none |\n| Rights and partnerships | can block (offline use needs rights) | high | doubtful | your statement |\n| Support | influences launch readiness | medium | unknown | none |\n\n## 3. What each group cares about\nRights: terms and the risk of offline copies. Support: ticket volume and answers ready.\n\n## 4. What to bring and when\nRights: a one-page description of how downloads expire, before the gate pack goes out.\n\n## 5. Order of conversations\nRights first, then support, then leadership.\n\n## 6. Gaps and risks\nLegal is missing from the map; the dependencies show a legal review for a similar initiative.\n\n## 7. Alignment in Product Velocity\nAlignment status shows 'not started'. Suggestion: open an alignment round after the rights conversation; I do not open it."
  },
  "pv-readiness": {
    "input": "pv-readiness R-04. A small group first, then widen. 15 March, fixed by a partner event. Support lead owns support; the rollback is a flag owned by engineering.",
    "output": "## 1. The launch in one line\nOffline listening to 10% of mobile listeners on 15 March, widening on a signal. Success measure: episodes per weekly mobile listener, 3.1 to 3.8 (key result).\n\n## 2. Checklist\n| Area | Check | Status | Source | Owner | Date |\n|---|---|---|---|---|---|\n| Product | acceptance passed | open | none | engineering | 8 Mar |\n| Measurement | the events dashboard shows episodes per listener | done | success metrics v1 | data | n/a |\n| Support | macro for top questions | open | none | support lead | 10 Mar |\n| Legal | rights confirmed for offline use | unknown | none | not set | n/a |\n| Rollback | flag turns it off, time to roll back | unknown | stated only | engineering | n/a |\n\n## 3. Blocking gaps\nRights confirmation has no owner and no date.\n\n## 4. Safe to widen\nContinue if the error rate stays under your threshold (to define); pause on any data-loss report.\n\n## 5. Day one\nSupport lead reads the issue queue at noon; first key result read after one week.\n\n## 6. Open questions\nWho owns rights? How long does a rollback take?"
  },
};
for (const [k, w] of Object.entries(WORKED)) if (SKILL_DEPTH[k]) SKILL_DEPTH[k] = { ...SKILL_DEPTH[k]!, worked: w };
