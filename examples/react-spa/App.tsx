import { AuthProvider, useAuth } from "@oauth-spa-kit/react";

function Profile() {
  const { ready, loggedIn, user, login, logout } = useAuth();

  if (!ready) return <p>Loading...</p>;
  if (!loggedIn) return <button onClick={() => login()}>Log in</button>;

  return (
    <div>
      <p>Signed in as {String(user?.sub)}</p>
      <button onClick={() => logout()}>Log out</button>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Profile />
    </AuthProvider>
  );
}
