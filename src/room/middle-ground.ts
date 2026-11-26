// Middle Ground: the rules of a Middle Ground Round. Each person picks one of
// two Sides for the whole Round (only the Host moves them after that). For each
// Prompt, Playing people privately choose to step into the middle or stay;
// choices stay hidden until the reveal, then stepping in and back out is live;
// the Prompt ends with a summary card. Pure and dependency-free like the rest of
// the Room module.

/** Which of the Round's two Sides: 0 for the first, 1 for the second. */
export type SideIndex = 0 | 1;

export type MiddleGroundStep =
  /** People are choosing; choices are hidden from those Playing. */
  | "choosing"
  /** Choices are out and stepping in or back out is live. */
  | "revealed"
  /** The Prompt is over: its summary card is on the Stage. */
  | "summary";

/** A Middle Ground Round in play: the Sides, who is on which, and the current Prompt. */
export interface MiddleGround {
  sides: [string, string];
  /** Each person's Side, for the whole Round. Missing until they pick. */
  sideOf: Record<string, SideIndex>;
  prompt: MiddleGroundPrompt;
}

export interface MiddleGroundPrompt {
  step: MiddleGroundStep;
  /** Person ids Playing this Prompt, in Waiting Room order. */
  playing: string[];
  /** Whether each person is in the middle. Missing until they choose (before the reveal). */
  inMiddle: Record<string, boolean>;
  /** Fixed when the Prompt ends, so people leaving afterwards don't change it. */
  summary: MiddleGroundSummary | null;
}

/** How many stepped in from each Side, out of how many were on it, in Side order. */
export interface MiddleGroundSummary {
  steppedIn: [number, number];
  onSide: [number, number];
}

export type MiddleGroundRejectionCode =
  | "not-playing"
  | "side-invalid"
  | "side-already-picked"
  | "no-side"
  | "already-chosen"
  | "choices-frozen";

export interface MiddleGroundRejection {
  code: MiddleGroundRejectionCode;
  message: string;
}

type Outcome = { middleGround: MiddleGround } | { rejection: MiddleGroundRejection };

export interface MiddleGroundPersonView {
  personId: string;
  nickname: string;
  /** Null until they pick a Side. */
  side: SideIndex | null;
  /** Whether they're Playing this Prompt (someone who joined mid-Prompt isn't yet). */
  playing: boolean;
  chosen: boolean;
  /** Null while choices are hidden from this viewer, or before they choose. */
  inMiddle: boolean | null;
}

export interface MiddleGroundView {
  sides: [string, string];
  step: MiddleGroundStep;
  /** Whether this viewer sees choices. False for anyone Playing before the reveal. */
  choicesVisible: boolean;
  /** Everyone Playing this Prompt or on a Side, in Waiting Room order. */
  people: MiddleGroundPersonView[];
  /** The viewer's own place, if they can take part in this Round. */
  yours: { side: SideIndex | null; playing: boolean; inMiddle: boolean | null } | null;
  /** The summary card. Only once the Prompt ends. */
  summary: MiddleGroundSummary | null;
}

export function startMiddleGround(sides: [string, string], playing: string[]): MiddleGround {
  return { sides, sideOf: {}, prompt: startPrompt(playing) };
}

/** Starts the next Prompt. Sides carry over for the whole Round. */
export function nextMiddleGroundPrompt(
  middleGround: MiddleGround,
  playing: string[],
): MiddleGround {
  return { ...middleGround, prompt: startPrompt(playing) };
}

/** Someone picks their own Side. After that, only the Host can move them. */
export function pickSide(middleGround: MiddleGround, personId: string, side: number): Outcome {
  if (!isSide(side)) return SIDE_INVALID;
  if (middleGround.sideOf[personId] !== undefined) {
    return refuse(
      "side-already-picked",
      "You've already picked a Side. Only the Host can move you to the other one.",
    );
  }
  return { middleGround: setSide(middleGround, personId, side) };
}

/** The Host moves someone who has a Side to a Side. */
export function moveToSide(middleGround: MiddleGround, personId: string, side: number): Outcome {
  if (!isSide(side)) return SIDE_INVALID;
  if (middleGround.sideOf[personId] === undefined) {
    return refuse("no-side", "They haven't picked a Side yet.");
  }
  return { middleGround: setSide(middleGround, personId, side) };
}

/**
 * A Playing person steps into the middle or stays. Before the reveal the choice
 * is private and final; after it, stepping in and back out is live.
 */
export function chooseMiddle(
  middleGround: MiddleGround,
  personId: string,
  stepIn: boolean,
): Outcome {
  const { prompt } = middleGround;
  if (!prompt.playing.includes(personId)) {
    return refuse("not-playing", "You're not Playing this Prompt. You'll be in from the next one.");
  }
  if (prompt.step === "summary") return refuse("choices-frozen", "This Prompt is over.");
  if (middleGround.sideOf[personId] === undefined) {
    return refuse("no-side", "Pick a Side first.");
  }
  if (prompt.step === "choosing" && prompt.inMiddle[personId] !== undefined) {
    return refuse("already-chosen", "You've already chosen for this Prompt.");
  }
  return {
    middleGround: {
      ...middleGround,
      prompt: { ...prompt, inMiddle: { ...prompt.inMiddle, [personId]: stepIn } },
    },
  };
}

/** Whether everyone Playing has chosen, which reveals the choices. */
export function everyoneChosen(middleGround: MiddleGround): boolean {
  const { prompt } = middleGround;
  return prompt.playing.length > 0 && prompt.playing.every((id) => id in prompt.inMiddle);
}

/** Shows every choice at once. Anyone who hadn't chosen stays with their Side. */
export function revealChoices(middleGround: MiddleGround): MiddleGround {
  const { prompt } = middleGround;
  return {
    ...middleGround,
    prompt: {
      ...prompt,
      step: "revealed",
      inMiddle: Object.fromEntries(prompt.playing.map((id) => [id, prompt.inMiddle[id] === true])),
    },
  };
}

/** Ends a revealed Prompt: choices freeze and the summary card shows. */
export function endMiddleGroundPrompt(middleGround: MiddleGround): MiddleGround {
  const { prompt, sideOf } = middleGround;
  const summary: MiddleGroundSummary = { steppedIn: [0, 0], onSide: [0, 0] };
  for (const id of prompt.playing) {
    const side = sideOf[id];
    if (side === undefined) continue;
    summary.onSide[side] += 1;
    if (prompt.inMiddle[id]) summary.steppedIn[side] += 1;
  }
  return { ...middleGround, prompt: { ...prompt, step: "summary", summary } };
}

/** Drops someone who left the Room. Once the Prompt is over, its summary stays as it was. */
export function dropFromMiddleGround(middleGround: MiddleGround, personId: string): MiddleGround {
  const { [personId]: _side, ...sideOf } = middleGround.sideOf;
  const { prompt } = middleGround;
  if (prompt.step === "summary" || !prompt.playing.includes(personId)) {
    return { ...middleGround, sideOf };
  }
  const { [personId]: _choice, ...inMiddle } = prompt.inMiddle;
  return {
    ...middleGround,
    sideOf,
    prompt: { ...prompt, playing: prompt.playing.filter((id) => id !== personId), inMiddle },
  };
}

/** Each Playing person's choice: null if they haven't chosen. */
export function choices(middleGround: MiddleGround): Record<string, boolean | null> {
  const { prompt } = middleGround;
  return Object.fromEntries(prompt.playing.map((id) => [id, prompt.inMiddle[id] ?? null]));
}

/**
 * @param personOrder everyone who can take part in the Round, in Waiting Room order.
 * @param viewer.personId the viewer, if they can take part in the Round.
 */
export function viewMiddleGround(
  middleGround: MiddleGround,
  viewer: { personId: string | null; seesHidden: boolean },
  personOrder: string[],
  nicknames: Map<string, string>,
): MiddleGroundView {
  const { prompt, sideOf } = middleGround;
  const choicesVisible = prompt.step !== "choosing" || viewer.seesHidden;
  const placeOf = (personId: string) => ({
    side: sideOf[personId] ?? null,
    playing: prompt.playing.includes(personId),
    inMiddle: prompt.inMiddle[personId] ?? null,
  });
  return {
    sides: middleGround.sides,
    step: prompt.step,
    choicesVisible,
    people: personOrder
      .filter((id) => prompt.playing.includes(id) || sideOf[id] !== undefined)
      .map((personId) => {
        const place = placeOf(personId);
        return {
          personId,
          nickname: nicknames.get(personId) ?? "",
          side: place.side,
          playing: place.playing,
          chosen: personId in prompt.inMiddle,
          inMiddle: choicesVisible ? place.inMiddle : null,
        };
      }),
    yours: viewer.personId === null ? null : placeOf(viewer.personId),
    summary: prompt.summary,
  };
}

function startPrompt(playing: string[]): MiddleGroundPrompt {
  return { step: "choosing", playing, inMiddle: {}, summary: null };
}

function setSide(middleGround: MiddleGround, personId: string, side: SideIndex): MiddleGround {
  return { ...middleGround, sideOf: { ...middleGround.sideOf, [personId]: side } };
}

function isSide(side: number): side is SideIndex {
  return side === 0 || side === 1;
}

function refuse(code: MiddleGroundRejectionCode, message: string): Outcome {
  return { rejection: { code, message } };
}

const SIDE_INVALID = refuse("side-invalid", "There are only two Sides.");
