/**
 * The Host's Speaking timer choices. A list value can't be null (null means
 * "nothing chosen"), so Off is its own value and the lengths are seconds as text.
 */
const OFF = "off";

export const TIMER_CHOICES: { value: string; label: string }[] = [
  { value: OFF, label: "Off" },
  { value: "30", label: "30 seconds" },
  { value: "60", label: "1 minute" },
  { value: "120", label: "2 minutes" },
  { value: "180", label: "3 minutes" },
  { value: "300", label: "5 minutes" },
];

/** The choice for a timer length in seconds, or Off for none. */
export function timerChoice(seconds: number | null): string {
  return seconds === null ? OFF : String(seconds);
}

/** The timer length a choice stands for, in seconds, or null for Off. */
export function timerSeconds(choice: string): number | null {
  return choice === OFF ? null : Number(choice);
}
