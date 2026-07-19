import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ComingSoonPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

export function ComingSoonPage({ title, description, icon: Icon }: ComingSoonPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Card>
        <CardHeader>
          <Icon className="h-5 w-5 text-accent" />
          <CardTitle>Module ready for a future unit</CardTitle>
          <CardDescription>
            This screen is a placeholder. The backend API already exists — the full management UI will be
            built in an upcoming unit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <span className="text-sm font-medium text-subtle-foreground">Coming soon</span>
        </CardContent>
      </Card>
    </div>
  );
}
