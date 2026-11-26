import { AtlasDestinationGuideView } from '@/components/atlas/atlas-destination-guide';

export default async function AtlasDestinationPage({
  params,
}: Readonly<{ params: Promise<{ countryCode: string; slug: string }> }>) {
  const { countryCode, slug } = await params;
  return (
    <AtlasDestinationGuideView countryCode={countryCode.toUpperCase()} slug={slug.toLowerCase()} />
  );
}
