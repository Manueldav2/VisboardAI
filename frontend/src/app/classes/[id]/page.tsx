import ClassDetail from './ClassDetail';

export async function generateStaticParams() {
  return [{ id: 'placeholder' }];
}

export default function ClassDetailPage() {
  return <ClassDetail />;
}
