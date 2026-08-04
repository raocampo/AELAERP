import { Redirect } from 'expo-router';
import { useAuth, primerTabDisponible } from '../context/AuthContext';

export default function Index() {
  const { sistema } = useAuth();
  return <Redirect href={primerTabDisponible(sistema)} />;
}
