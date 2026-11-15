import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CalendarDays, ChevronLeft, Clock3, Crosshair, MapPin, Search, Users, X,
} from 'lucide-react';

export type MapEvent = {
  id: string;
  title: string;
  category: string;
  date: string;
  time: string;
  place: string;
  city?: string;
  participantCount: number;
  capacity: number;
  joined: boolean;
  lat?: number | null;
  lng?: number | null;
};

const TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_59gk_1_d75c5ae9c69331b73fcd5d2b';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Запасной центр, если нет ни событий, ни геопозиции (вся Россия).
const FALLBACK_CENTER: L.LatLngTuple = [55.75, 37.62];
const FALLBACK_ZOOM = 4;

const hasPoint = (
  event: MapEvent
): event is MapEvent & { lat: number; lng: number } =>
  typeof event.lat === 'number' &&
  typeof event.lng === 'number' &&
  Number.isFinite(event.lat) &&
  Number.isFinite(event.lng);

function formatDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
    });
  }

  return value;
}

function newMap(container: HTMLElement) {
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: true,
    worldCopyJump: true,
  });

  map.attributionControl.setPrefix(false);

  L.tileLayer(TILES, {
    subdomains: 'abcd',
    maxZoom: 19,
    attribution: ATTRIBUTION,
  }).addTo(map);

  // Контейнер появляется с анимацией: пересчитываем размер, когда она закончится.
  window.setTimeout(() => map.invalidateSize(), 350);

  return map;
}

const pinIcon = (count: number, selected: boolean) =>
  L.divIcon({
    className: 'map-pin-wrap',
    html: `<span class="map-pin${selected ? ' sel' : ''}"><b>${Math.max(
      0,
      Math.round(count)
    )}</b></span>`,
    iconSize: [40, 48],
    iconAnchor: [20, 46],
  });

const dotIcon = L.divIcon({
  className: 'map-pin-wrap',
  html: '<span class="map-pin-dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Геопозиция остаётся на устройстве и никуда не отправляется.
function locate(
  map: L.Map,
  setMe: (marker: L.Marker) => void,
  setError: (message: string) => void
) {
  if (!navigator.geolocation) {
    setError('Геолокация недоступна на этом устройстве');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const point: L.LatLngTuple = [
        position.coords.latitude,
        position.coords.longitude,
      ];

      setError('');
      setMe(L.marker(point, { icon: dotIcon, interactive: false }));
      map.flyTo(point, 14, { duration: 0.8 });
    },
    () => setError('Не удалось определить местоположение. Разреши доступ к геопозиции.'),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
}

// ---------- Карта событий ----------

type MapScreenProps = {
  events: MapEvent[];
  myCity?: string;
  onClose: () => void;
  onOpenEvent: (id: string) => void;
};

export default function MapScreen({
  events,
  myCity,
  onClose,
  onOpenEvent,
}: MapScreenProps) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const meRef = useRef<L.Marker | null>(null);
  const fitted = useRef(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [geoError, setGeoError] = useState('');

  const points = useMemo(() => events.filter(hasPoint), [events]);
  const withoutPoint = events.length - points.length;
  const selected = points.find((event) => event.id === selectedId) || null;

  // Создаём карту один раз.
  useEffect(() => {
    const container = holder.current;

    if (!container) return;

    const map = newMap(container);

    map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    map.on('click', () => setSelectedId(null));

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      meRef.current = null;
      fitted.current = false;
    };
  }, []);

  // Точки событий: пересобираем при смене списка или выбора.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;

    if (!map || !layer) return;

    layer.clearLayers();

    for (const event of points) {
      L.marker([event.lat, event.lng], {
        icon: pinIcon(event.participantCount, event.id === selectedId),
        title: event.title,
        keyboard: true,
      })
        .on({
          click: (leafletEvent) => {
            L.DomEvent.stopPropagation(leafletEvent.originalEvent);
            setSelectedId(event.id);
          },
        })
        .addTo(layer);
    }
  }, [points, selectedId]);

  // Первый показ: события твоего города, иначе все.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || fitted.current || points.length === 0) return;

    const city = (myCity || '').trim().toLowerCase();

    const local = city
      ? points.filter(
          (event) => (event.city || '').trim().toLowerCase() === city
        )
      : [];

    const focus = local.length > 0 ? local : points;

    map.fitBounds(
      L.latLngBounds(focus.map((event) => [event.lat, event.lng] as L.LatLngTuple)),
      { padding: [60, 60], maxZoom: 15 }
    );

    fitted.current = true;
  }, [points, myCity]);

  // Выбранное событие, которое пропало (удалили/прошло), снимаем.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const goToMe = () => {
    const map = mapRef.current;

    if (!map) return;

    locate(
      map,
      (marker) => {
        meRef.current?.remove();
        marker.addTo(map);
        meRef.current = marker;
      },
      setGeoError
    );
  };

  const pick = (id: string) => {
    const event = points.find((item) => item.id === id);

    if (event && mapRef.current) {
      mapRef.current.panTo([event.lat, event.lng], { animate: true });
    }

    setSelectedId(id);
  };

  const left = selected
    ? Math.max(0, selected.capacity - selected.participantCount)
    : 0;

  const fill = selected
    ? Math.min(
        100,
        Math.round(
          (selected.participantCount / Math.max(1, selected.capacity)) * 100
        )
      )
    : 0;

  return (
    <div className="fs-screen map-screen" role="dialog" aria-modal="true">
      <header className="map-head">
        <button className="group-back" onClick={onClose} aria-label="Назад">
          <ChevronLeft size={22} />
        </button>

        <div className="group-title">
          <b>Карта событий</b>
          <small>
            {points.length > 0
              ? `${points.length} на карте`
              : 'Пока нет событий с точкой'}
          </small>
        </div>
      </header>

      <div className="map-stage">
        <div className="map-canvas" ref={holder} />

        <button
          className="map-locate"
          onClick={goToMe}
          aria-label="Моё местоположение"
        >
          <Crosshair size={20} />
        </button>

        {geoError && <div className="map-note">{geoError}</div>}

        {points.length === 0 && (
          <div className="map-empty">
            <MapPin size={26} />
            <b>На карте пока пусто</b>
            <span>
              Когда создаёшь событие, отметь место на карте — оно появится здесь.
            </span>
          </div>
        )}

        {points.length > 0 && withoutPoint > 0 && !selected && (
          <div className="map-note low">
            Ещё {withoutPoint} без точки на карте — они в общей ленте.
          </div>
        )}

        {selected && (
          <section className="map-card" aria-live="polite">
            <button
              className="map-card-close"
              onClick={() => setSelectedId(null)}
              aria-label="Закрыть"
            >
              <X size={18} />
            </button>

            <div className="eyebrow">{selected.category}</div>
            <h3>{selected.title}</h3>

            <div className="detail-facts">
              <span>
                <CalendarDays size={16} />
                {formatDate(selected.date)}
              </span>
              <span>
                <Clock3 size={16} />
                Начало в {selected.time}
              </span>
              <span>
                <MapPin size={16} />
                {selected.place}
              </span>
            </div>

            <div className="map-people">
              <span>
                <Users size={16} />
                <b>{selected.participantCount}</b> из {selected.capacity} собираются
              </span>
              <i className="map-bar">
                <em style={{ width: `${fill}%` }} />
              </i>
              <small>
                {left > 0 ? `Свободных мест: ${left}` : 'Мест больше нет'}
                {selected.joined ? ' · ты участвуешь' : ''}
              </small>
            </div>

            <button className="primary" onClick={() => onOpenEvent(selected.id)}>
              Подробнее
            </button>
          </section>
        )}

        {points.length > 1 && !selected && (
          <div className="map-strip" role="list">
            {points.slice(0, 12).map((event) => (
              <button
                key={event.id}
                role="listitem"
                className="map-chip"
                onClick={() => pick(event.id)}
              >
                <b>{event.title}</b>
                <small>
                  {formatDate(event.date)} · {event.time}
                </small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Выбор места события ----------

type Found = { id: number; name: string; lat: number; lng: number };

type PickerProps = {
  initial?: { lat: number; lng: number } | null;
  cityHint?: string;
  onConfirm: (lat: number, lng: number) => void;
  onClose: () => void;
};

export function LocationPicker({
  initial,
  cityHint,
  onConfirm,
  onClose,
}: PickerProps) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const meRef = useRef<L.Marker | null>(null);

  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(
    initial || null
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');

  const place = (lat: number, lng: number, fly = false) => {
    const map = mapRef.current;

    if (!map) return;

    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      const marker = L.marker([lat, lng], {
        icon: pinIcon(0, true),
        draggable: true,
      }).addTo(map);

      marker.on('dragend', () => {
        const next = marker.getLatLng();
        setPoint({ lat: next.lat, lng: next.lng });
      });

      markerRef.current = marker;
    }

    setPoint({ lat, lng });

    if (fly) map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
  };

  useEffect(() => {
    const container = holder.current;

    if (!container) return;

    const map = newMap(container);

    mapRef.current = map;

    if (initial) {
      map.setView([initial.lat, initial.lng], 16);
      place(initial.lat, initial.lng);
    } else {
      map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
    }

    map.on({
      click: (event) => {
        place(event.latlng.lat, event.latlng.lng);
      },
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      meRef.current = null;
    };
    // Карта создаётся один раз; initial нужен только для стартовой точки.
  }, []);

  // Если города/точки нет, пробуем найти центр города из анкеты.
  useEffect(() => {
    if (initial || !cityHint) return;

    const controller = new AbortController();

    fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=${encodeURIComponent(cityHint)}`,
      { signal: controller.signal }
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: Array<{ lat: string; lon: string }>) => {
        const first = rows[0];
        const map = mapRef.current;

        if (first && map && !markerRef.current) {
          map.setView([Number(first.lat), Number(first.lon)], 12);
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [initial, cityHint]);

  const search = async (event: FormEvent) => {
    event.preventDefault();

    const text = query.trim();

    if (text.length < 3) {
      setMessage('Введи хотя бы 3 символа');
      return;
    }

    setSearching(true);
    setMessage('');

    try {
      const withCity =
        cityHint && !text.toLowerCase().includes(cityHint.toLowerCase())
          ? `${text}, ${cityHint}`
          : text;

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ru&q=${encodeURIComponent(withCity)}`
      );

      if (!response.ok) throw new Error('search failed');

      const rows = (await response.json()) as Array<{
        place_id: number;
        display_name: string;
        lat: string;
        lon: string;
      }>;

      const found = rows.map((row) => ({
        id: row.place_id,
        name: row.display_name,
        lat: Number(row.lat),
        lng: Number(row.lon),
      }));

      setResults(found);

      if (found.length === 0) setMessage('Ничего не нашли. Попробуй иначе или ткни в карту.');
    } catch {
      setMessage('Поиск не сработал. Отметь место прямо на карте.');
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = () => {
    const map = mapRef.current;

    if (!map) return;

    locate(
      map,
      (marker) => {
        meRef.current?.remove();
        marker.addTo(map);
        meRef.current = marker;
      },
      setMessage
    );
  };

  return (
    <div className="fs-screen map-screen picker-screen" role="dialog" aria-modal="true">
      <header className="map-head">
        <button className="group-back" onClick={onClose} aria-label="Закрыть">
          <ChevronLeft size={22} />
        </button>

        <div className="group-title">
          <b>Место встречи</b>
          <small>Выбери общественное место, не домашний адрес</small>
        </div>
      </header>

      <form className="picker-search" onSubmit={(event) => void search(event)}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти место или адрес"
          maxLength={120}
        />

        <button type="submit" disabled={searching} aria-label="Найти">
          <Search size={18} />
        </button>
      </form>

      {results.length > 0 && (
        <div className="picker-results">
          {results.map((row) => (
            <button
              key={row.id}
              onClick={() => {
                place(row.lat, row.lng, true);
                setResults([]);
              }}
            >
              <MapPin size={14} />
              <span>{row.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="map-stage">
        <div className="map-canvas" ref={holder} />

        <button
          className="map-locate"
          onClick={useMyLocation}
          aria-label="Моё местоположение"
        >
          <Crosshair size={20} />
        </button>

        {message && <div className="map-note">{message}</div>}

        {!point && !message && (
          <div className="map-note low">Нажми на карту, чтобы поставить точку</div>
        )}
      </div>

      <div className="picker-actions">
        <button className="ghost" onClick={onClose}>
          Отмена
        </button>

        <button
          className="primary"
          disabled={!point}
          onClick={() => point && onConfirm(point.lat, point.lng)}
        >
          Выбрать это место
        </button>
      </div>
    </div>
  );
}
