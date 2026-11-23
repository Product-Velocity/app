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
  }
};
for (const [k, w] of Object.entries(WORKED)) if (SKILL_DEPTH[k]) SKILL_DEPTH[k] = { ...SKILL_DEPTH[k]!, worked: w };
