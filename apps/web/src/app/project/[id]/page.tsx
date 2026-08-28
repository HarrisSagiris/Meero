import { BuilderPageView } from "@/modules/builder/views/ui/builder-page-view";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BuilderPageView projectId={id} />;
}
