import { getShortName, getNameFromPath } from '../utils'
import makeState from './state'
import makeGetters from './getters'
import makeMutations from './mutations'
import makeActions from './actions'
import makeModel from './model'

const defaults = {
  idField: 'id', // The field in each record that will contain the id
  autoRemove: false, // automatically remove records missing from responses (only use with feathers-rest)
  nameStyle: 'short', // Determines the source of the module name. 'short', 'path', or 'explicit'
  enableEvents: true, // Listens to socket.io events when available
  preferUpdate: false, // When true, calling model.save() will do an update instead of a patch.
  state: {},     // for custom state
  getters: {},   // for custom getters
  mutations: {}, // for custom mutations
  actions: {}    // for custom actions
}

export default function servicePluginInit (feathersClient, globalOptions = {}) {
  if (!feathersClient || !feathersClient.service) {
    throw new Error('You must provide a Feathers Client instance to feathers-vuex')
  }

  globalOptions = Object.assign({}, defaults, globalOptions)

  const serviceModule = function serviceModule (servicePath, options = {}) {
    if (!feathersClient || !feathersClient.service) {
      throw new Error('You must provide a service path or object to create a feathers-vuex service module')
    }

    options = Object.assign({}, globalOptions, options)
    const { idField, autoRemove, preferUpdate, enableEvents } = options

    if (typeof servicePath !== 'string') {
      throw new Error('The first argument to setup a feathers-vuex service must be a string')
    }

    const service = feathersClient.service(servicePath)
    if (!service) {
      throw new Error('No service was found. Please configure a transport plugin on the Feathers Client. Make sure you use the client version of the transport, like `feathers-socketio/client` or `feathers-rest/client`.')
    }
    const paginate = service.hasOwnProperty('paginate') && service.paginate.hasOwnProperty('default')

    const defaultState = makeState(servicePath, { idField, autoRemove, paginate, preferUpdate, enableEvents })
    const defaultGetters = makeGetters(servicePath)
    const defaultMutations = makeMutations(servicePath)
    const defaultActions = makeActions(service)
    const module = {
      namespaced: true,
      state: Object.assign({}, defaultState, options.state),
      getters: Object.assign({}, defaultGetters, options.getters),
      mutations: Object.assign({}, defaultMutations, options.mutations),
      actions: Object.assign({}, defaultActions, options.actions)
    }
    return module
  }

  const serviceModel = function serviceModel (module) {
    const Model = makeModel(module)

    return Model
  }

  const servicePlugin = function servicePlugin (module, Model, options = {}) {
    const { servicePath } = module.state
    const nameStyle = options.nameStyle || globalOptions.nameStyle
    const service = feathersClient.service(servicePath)

    const nameStyles = {
      short: getShortName,
      path: getNameFromPath
    }
    let namespace = options.namespace || nameStyles[nameStyle](servicePath)

    return function setupStore (store) {
      store.registerModule(namespace, module)

      // Upgrade the Model's API methods to use the store.actions
      Object.assign(Model.prototype, {
        _create (data, params) {
          return store.dispatch(`${namespace}/addItem`, [data, params])
        },
        _patch (id, data, params) {
          return store.dispatch(namespace + '/patch', [id, data, params])
        },
        _update (id, data, params) {
          return store.dispatch(namespace + '/update', [id, data, params])
        },
        _remove (id, params) {
          return store.dispatch(namespace + '/remove', [id, params])
        }
      })

      if (options.enableEvents) {
        // Listen to socket events when available.
        service.on('created', item => store.commit(`${namespace}/addItem`, item))
        service.on('updated', item => store.commit(`${namespace}/updateItem`, item))
        service.on('patched', item => store.commit(`${namespace}/updateItem`, item))
        service.on('removed', item => store.commit(`${namespace}/removeItem`, item))
      }
    }
  }

  const createServicePlugin = function createServicePlugin (servicePath, options = {}) {
    const module = serviceModule(servicePath, options)
    const Model = serviceModel(module)

    return servicePlugin(module, Model, options)
  }

  Object.assign(createServicePlugin, {
    serviceModule,
    serviceModel,
    servicePlugin
  })

  return createServicePlugin
}
