import { ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AccessDenied() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Access denied</h1>
        <p className="text-sm text-muted-foreground">You do not have permission to view this page.</p>
      </div>
      <Card>
        <CardHeader>
          <ShieldAlert className="h-5 w-5 text-error" />
          <CardTitle>Missing permission</CardTitle>
          <CardDescription>
            Contact an administrator if you believe you should have access to this module.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
