'use client';
import { RoleGuard } from '@/components/ui';
import PapersVault from '@/components/papers/PapersVault';

// Important papers: the document vault (overview, folders, recycle bin). Who can open it is decided in Roles.
export default function PapersPage() {
  return <RoleGuard perm="documents"><PapersVault /></RoleGuard>;
}
