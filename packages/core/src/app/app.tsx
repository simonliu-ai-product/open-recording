import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from './routes/home';
import { RecordingPage } from './routes/recording';
import { SetupPage } from './routes/setup';
import { Shell } from './routes/shell';

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Home />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/r/:id" element={<RecordingPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <div className="grid h-dvh place-items-center bg-background px-6 text-center text-foreground">
      <div>
        <p className="folio">404</p>
        <h1 className="mt-2 font-semibold text-xl tracking-tight">Nothing here</h1>
      </div>
    </div>
  );
}
