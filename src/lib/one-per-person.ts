export type OnePerPersonValidation =
  | 'allowed'
  | 'already-submitted'
  | 'too-many';

export function validateOnePerPersonSubmission(
  existingCount: number,
  newCount: number
): OnePerPersonValidation {
  if (existingCount > 0) return 'already-submitted';
  if (newCount > 1) return 'too-many';
  return 'allowed';
}
