import { AtlasGuideView } from '@/components/atlas/atlas-guide';

export default async function AtlasGuidePage({
  params,
}: Readonly<{ params: Promise<{ countryCode: string }> }>) {
  const { countryCode } = await params;
  return <AtlasGuideView countryCode={countryCode.toUpperCase()} />;
}
