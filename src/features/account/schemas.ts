import { z } from "zod";
import { personName } from "@/lib/validation";

/** Only the display name is self-editable. Any other key is rejected. */
export const updateProfileSchema = z.object({ name: personName }).strict();
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;
