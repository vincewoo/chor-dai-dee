import tensorflow.compat.v1 as tf
tf.disable_v2_behavior()
import numpy as np
import joblib

# Mock fc from baselines.a2c.utils since we don't have baselines installed
def fc(x, scope, nh, *, init_scale=1.0, init_bias=0.0):
    with tf.variable_scope(scope):
        nin = x.get_shape()[1].value
        w = tf.get_variable("w", [nin, nh], initializer=tf.orthogonal_initializer(init_scale))
        b = tf.get_variable("b", [nh], initializer=tf.constant_initializer(init_bias))
        return tf.matmul(x, w) + b

class PPONetwork(object):

    def __init__(self, sess, obs_dim, act_dim, name):
        self.obs_dim = obs_dim
        self.act_dim = act_dim
        self.name = name

        with tf.variable_scope(name):
            X = tf.placeholder(tf.float32, [None, obs_dim], name="input")
            available_moves = tf.placeholder(tf.float32, [None, act_dim], name="availableActions")
            #available_moves takes form [0, 0, -inf, 0, -inf...], 0 if action is available, -inf if not.
            activation = tf.nn.relu
            h1 = activation(fc(X,'fc1', nh=512, init_scale=np.sqrt(2)))
            h2 = activation(fc(h1,'fc2', nh=256, init_scale=np.sqrt(2)))
            pi = fc(h2,'pi', act_dim, init_scale = 0.01)
            #value function - share layer h1
            h3 = activation(fc(h1,'fc3', nh=256, init_scale=np.sqrt(2)))
            vf = fc(h3, 'vf', 1)[:,0]
        availPi = tf.add(pi, available_moves)

        def sample():
            u = tf.random_uniform(tf.shape(availPi))
            return tf.argmax(availPi - tf.log(-tf.log(u)), axis=-1)

        a0 = sample()
        el0in = tf.exp(availPi - tf.reduce_max(availPi, axis=-1, keepdims=True))
        z0in = tf.reduce_sum(el0in, axis=-1, keepdims=True)
        p0in = el0in / z0in
        onehot = tf.one_hot(a0, availPi.get_shape().as_list()[-1])
        neglogpac = -tf.log(tf.reduce_sum(tf.multiply(p0in, onehot), axis=-1))

        def step(obs, availAcs):
            a, v, neglogp = sess.run([a0, vf, neglogpac], {X:obs, available_moves:availAcs})
            return a, v, neglogp

        def value(obs, availAcs):
            return sess.run(vf, {X:obs, available_moves:availAcs})

        self.availPi = availPi
        self.neglogpac = neglogpac
        self.X = X
        self.available_moves = available_moves
        self.pi = pi
        self.vf = vf
        self.step = step
        self.value = value
        self.params = tf.get_collection(tf.GraphKeys.TRAINABLE_VARIABLES, scope=self.name)

        def getParams():
            return sess.run(self.params)

        self.getParams = getParams

        def loadParams(paramsToLoad):
            restores = []
            for p, loadedP in zip(self.params, paramsToLoad):
                restores.append(p.assign(loadedP))
            sess.run(restores)

        self.loadParams = loadParams

        def saveParams(path):
            modelParams = sess.run(self.params)
            joblib.dump(modelParams, path)

        self.saveParams = saveParams
