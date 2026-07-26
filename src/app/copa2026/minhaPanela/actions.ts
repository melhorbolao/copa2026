'use server'

import { createAuthAdminClient } from '@/lib/supabase/server'
import { assertNotArchived } from '@/lib/tournament-lock'

export async function updatePanela(
  ownerParticipantId: string,
  memberIds: string[],
): Promise<void> {
  assertNotArchived('updatePanela')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  await admin
    .from('user_panela')
    .delete()
    .eq('owner_participant_id', ownerParticipantId)

  if (memberIds.length > 0) {
    await admin.from('user_panela').insert(
      memberIds.map(id => ({
        owner_participant_id:  ownerParticipantId,
        member_participant_id: id,
      })),
    )
  }
}
