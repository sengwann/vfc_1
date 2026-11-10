import "server-only";

export type AgeGroup =
  | "Children"
  | "Teenagers"
  | "Adults"
  | "Elderly"
  | "Not set";

export interface AgeGroupCount {
  group: AgeGroup;
  count: number;
}

/**
 * Calculates age correctly by comparing year, month, and day.
 * Does NOT simply subtract birth year from current year.
 */
export function calculateAge(
  dateOfBirth: Date,
  referenceDate: Date = new Date(),
): number {
  let age = referenceDate.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = referenceDate.getMonth() - dateOfBirth.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && referenceDate.getDate() < dateOfBirth.getDate())
  ) {
    age--;
  }

  return age;
}

/**
 * Maps a calculated age into the defined age groups.
 * 0–12   → Children
 * 13–17  → Teenagers
 * 18–59  → Adults
 * 60+    → Elderly
 */
export function getAgeGroup(age: number): AgeGroup {
  if (age < 0) return "Not set"; // Invalid DOB (future date)
  if (age <= 12) return "Children";
  if (age <= 17) return "Teenagers";
  if (age <= 59) return "Adults";
  return "Elderly";
}

/**
 * Validates that a dateOfBirth is reasonable.
 * Returns null if invalid (future date, too old, etc.)
 */
export function validateDateOfBirth(dob: Date): Date | null {
  const now = new Date();
  const minDate = new Date("1900-01-01");

  if (dob > now) return null; // Future date is invalid
  if (dob < minDate) return null; // Unreasonably old

  return dob;
}

/**
 * Aggregates an array of nullable dateOfBirth values into age group counts.
 * This is the main function used by the Chief dashboard.
 *
 * - null/undefined DOB → "Not set"
 * - Invalid DOB (future, etc.) → "Not set"
 * - Valid DOB → calculated age → age group
 */
export function aggregateAgeGroups(
  datesOfBirth: (Date | null)[],
): AgeGroupCount[] {
  const counts: Record<AgeGroup, number> = {
    Children: 0,
    Teenagers: 0,
    Adults: 0,
    Elderly: 0,
    "Not set": 0,
  };

  const now = new Date();

  for (const dob of datesOfBirth) {
    if (!dob) {
      counts["Not set"]++;
      continue;
    }

    const validDob = validateDateOfBirth(dob);
    if (!validDob) {
      counts["Not set"]++;
      continue;
    }

    const age = calculateAge(validDob, now);
    const group = getAgeGroup(age);
    counts[group]++;
  }

  // Return in display order
  return [
    { group: "Children", count: counts.Children },
    { group: "Teenagers", count: counts.Teenagers },
    { group: "Adults", count: counts.Adults },
    { group: "Elderly", count: counts.Elderly },
    { group: "Not set", count: counts["Not set"] },
  ];
}
