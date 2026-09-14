import { AutoScroller, PointerSensor, PointerActivationConstraints } from '@dnd-kit/dom'
import { CalendarAwareAutoScroller } from '../utils/CalendarAwareAutoScroller'

export const configureDndPlugins = (plugins) =>
  plugins.map((plugin) => {
    if (plugin === AutoScroller) {
      return {
        plugin: CalendarAwareAutoScroller,
        options: {
          acceleration: 14,
          threshold: { x: 0.02, y: 0.08 },
        },
      }
    }

    return plugin
  })

export const configureDndSensors = (sensors) =>
  sensors.map((sensor) => {
    if (sensor === PointerSensor) {
      return PointerSensor.configure({
        activationConstraints: (event, source) => {
          const activationDistance = source.data?.pointerActivationDistance
          if (event.pointerType === 'mouse' && Number.isFinite(activationDistance)) {
            return [
              new PointerActivationConstraints.Distance({
                value: activationDistance,
              }),
            ]
          }

          const defaultConstraints = PointerSensor.defaults.activationConstraints
          return typeof defaultConstraints === 'function'
            ? defaultConstraints(event, source)
            : defaultConstraints
        },
        activatorElements: (source) => {
          const selector = source.data?.pointerActivatorSelector
          if (selector && source.element) {
            return [source.element.querySelector(selector)]
          }
          return [source.handle || source.element]
        },
      })
    }

    return sensor
  })
