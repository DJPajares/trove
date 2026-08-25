import { redirect } from 'next/navigation';

import { defaultToolPath } from '@/lib/navigation';

export default function ToolsPage() {
  redirect(defaultToolPath);
}
